import { useEffect } from "react";
import Lenis from "lenis";

// El scroll nativo avanza a saltos, así que cualquier animación atada a él se
// percibe entrecortada por más que sus valores sean correctos. Lenis interpola
// la posición cuadro a cuadro sobre el scroll real del navegador: no rompe
// `position: sticky` ni los IntersectionObserver, y deja que el movimiento se
// lea como un deslizamiento continuo.
//
// Devuelve la instancia por si alguna vista necesita `scrollTo` controlado.
export function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === "undefined") return undefined;

    // Respetar la preferencia del sistema: para quien pide menos movimiento,
    // el scroll instantáneo del navegador es la opción correcta.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return undefined;

    // Un puntero grueso (móvil/tablet) ya trae inercia nativa del sistema
    // operativo; duplicarla se siente pesado y pelea con el gesto.
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (coarsePointer) return undefined;

    const lenis = new Lenis({
      duration: 1.05,
      // Salida exponencial: arranca rápido y se asienta sin rebote.
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
    });

    let frame = 0;
    const raf = (time) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    // Los enlaces internos deben seguir llevando al ancla correcta.
    const onAnchorClick = (event) => {
      const link = event.target.closest?.('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target, { offset: -90 });
    };
    document.addEventListener("click", onAnchorClick);

    return () => {
      document.removeEventListener("click", onAnchorClick);
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [enabled]);
}
