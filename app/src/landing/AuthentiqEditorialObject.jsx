import { useEffect, useRef, useState } from "react";

// Procedural hero object based on the img2threejs approach:
// code-only geometry, named pivots, deterministic detail and a deliberately
// approximate silhouette. It is a brand artifact, not a catalog vehicle model.
export default function AuthentiqEditorialObject({ label = "ZEVROA editorial 3D object", reduceMotion = false }) {
  const mountRef = useRef(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    if (reduceMotion || window.matchMedia("(pointer: coarse)").matches) {
      setDegraded(true);
      return undefined;
    }
    setDegraded(false);

    let disposed = false;
    let renderer;
    let frame = 0;
    let observer;
    let resizeObserver;
    let onMove;
    let onLeave;

    const load = async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
        camera.position.set(0, 0.7, 7.1);
        camera.lookAt(0, 0.25, 0);

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.className = "authentiq-editorial-canvas";
        mount.appendChild(renderer.domElement);

        const root = new THREE.Group();
        root.name = "authentiq-editorial-coupe-root";
        root.position.y = -0.18;
        scene.add(root);

        const bodyMaterial = new THREE.MeshPhysicalMaterial({
          color: 0x9ba1a3,
          metalness: 0.82,
          roughness: 0.26,
          clearcoat: 0.72,
          clearcoatRoughness: 0.18,
        });
        const darkMaterial = new THREE.MeshPhysicalMaterial({ color: 0x080b0c, metalness: 0.56, roughness: 0.3, clearcoat: 0.4 });
        const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x17252a, metalness: 0.18, roughness: 0.08, transmission: 0.08, transparent: true, opacity: 0.88, clearcoat: 0.8 });
        const goldMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd9ad52, metalness: 0.96, roughness: 0.2, clearcoat: 0.5 });
        const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffe8a0, toneMapped: false });

        const makeShape = (points) => {
          const shape = new THREE.Shape();
          shape.moveTo(points[0][0], points[0][1]);
          points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
          shape.closePath();
          return shape;
        };
        const extrude = (shape, depth, material, bevel = 0.04) => {
          const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel, curveSegments: 8 });
          geometry.translate(0, 0, -depth / 2);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          return mesh;
        };

        // Macro silhouette: low roofline, long hood, short rear deck.
        const body = new THREE.Group();
        body.name = "body-shell";
        body.add(extrude(makeShape([
          [-2.92, -0.36], [-2.8, -0.02], [-2.48, 0.18], [-1.85, 0.28], [-1.24, 0.36],
          [-0.74, 0.88], [-0.18, 1.2], [0.56, 1.23], [1.22, 1.04], [1.73, 0.67],
          [2.55, 0.48], [2.88, 0.2], [2.98, -0.22], [2.76, -0.38], [1.92, -0.38],
          [1.66, -0.15], [-1.75, -0.15], [-1.98, -0.38],
        ]), 1.08, bodyMaterial, 0.07));
        root.add(body);

        const lower = new THREE.Group();
        lower.name = "lower-air-intake";
        lower.add(extrude(makeShape([[-2.78, -0.08], [-2.5, 0.08], [-1.85, 0.1], [-1.5, -0.22], [1.78, -0.22], [2.64, -0.12], [2.83, -0.32], [1.95, -0.46], [-2.54, -0.46]]), 1.12, darkMaterial, 0.035));
        root.add(lower);

        const cabin = new THREE.Group();
        cabin.name = "glass-cabin";
        cabin.add(extrude(makeShape([[-0.64, 0.48], [-0.1, 1.06], [0.47, 1.1], [1.13, 0.92], [1.57, 0.56], [0.92, 0.52], [0.22, 0.5]]), 1.1, glassMaterial, 0.025));
        root.add(cabin);

        const belt = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.025, 1.13), goldMaterial);
        belt.name = "gold-beltline";
        belt.position.set(0.15, 0.45, 0);
        root.add(belt);

        const wheelMaterial = new THREE.MeshPhysicalMaterial({ color: 0x0d1011, metalness: 0.72, roughness: 0.25, clearcoat: 0.38 });
        const tireGeometry = new THREE.CylinderGeometry(0.53, 0.53, 0.18, 32);
        const rimGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 20);
        const hubGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.22, 16);
        const ringGeometry = new THREE.TorusGeometry(0.42, 0.035, 8, 28);
        [-1.72, 1.76].forEach((x) => {
          const wheel = new THREE.Group();
          wheel.name = x < 0 ? "rear-wheel" : "front-wheel";
          wheel.position.set(x, -0.22, 0.61);
          const tire = new THREE.Mesh(tireGeometry, wheelMaterial);
          tire.rotation.x = Math.PI / 2;
          const rim = new THREE.Mesh(rimGeometry, goldMaterial);
          rim.rotation.x = Math.PI / 2;
          const hub = new THREE.Mesh(hubGeometry, darkMaterial);
          hub.rotation.x = Math.PI / 2;
          const ring = new THREE.Mesh(ringGeometry, goldMaterial);
          wheel.add(tire, rim, hub, ring);
          root.add(wheel);
        });

        const lightGeometry = new THREE.BoxGeometry(0.48, 0.045, 0.025);
        [-2.26, 2.28].forEach((x, index) => {
          const light = new THREE.Mesh(lightGeometry, lightMaterial);
          light.name = index === 0 ? "front-light" : "rear-light";
          light.position.set(x, 0.17, 0.58);
          light.rotation.z = index === 0 ? -0.08 : 0.08;
          root.add(light);
        });

        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe2b95f, transparent: true, opacity: 0.8 });
        const contour = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-2.82, 0.0, 0.59), new THREE.Vector3(-1.78, 0.22, 0.59), new THREE.Vector3(-0.75, 0.88, 0.59),
          new THREE.Vector3(0.02, 1.2, 0.59), new THREE.Vector3(0.68, 1.14, 0.59), new THREE.Vector3(1.6, 0.57, 0.59), new THREE.Vector3(2.76, 0.3, 0.59),
        ]), lineMaterial);
        contour.name = "silhouette-contour";
        root.add(contour);

        const halo = new THREE.Mesh(new THREE.TorusGeometry(3.08, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0xd9ad52, transparent: true, opacity: 0.32 }));
        halo.name = "editorial-halo";
        halo.rotation.x = Math.PI / 2;
        halo.position.y = -0.82;
        root.add(halo);

        const points = [];
        for (let i = 0; i < 46; i += 1) {
          const angle = i * 2.399963;
          const radius = 2.5 + (i % 5) * 0.2;
          points.push(Math.cos(angle) * radius, 0.2 + (i % 7) * 0.26, Math.sin(angle) * 0.75 - 0.2);
        }
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0xe2b95f, size: 0.025, transparent: true, opacity: 0.55, sizeAttenuation: true }));
        particles.name = "ambient-particles";
        scene.add(particles);

        scene.add(new THREE.HemisphereLight(0x9bb1bd, 0x090b0b, 2.1));
        const key = new THREE.DirectionalLight(0xffefd0, 4.2);
        key.position.set(-3, 5, 5);
        scene.add(key);
        const rim = new THREE.PointLight(0xd9ad52, 5, 12, 2);
        rim.position.set(2.8, 1.8, -2.5);
        scene.add(rim);

        const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
        onMove = (event) => {
          const rect = mount.getBoundingClientRect();
          pointer.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          pointer.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        };
        onLeave = () => { pointer.targetX = 0; pointer.targetY = 0; };
        mount.addEventListener("pointermove", onMove, { passive: true });
        mount.addEventListener("pointerleave", onLeave, { passive: true });

        const resize = () => {
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        resize();

        const render = (time) => {
          if (disposed) return;
          pointer.x += (pointer.targetX - pointer.x) * 0.055;
          pointer.y += (pointer.targetY - pointer.y) * 0.055;
          root.rotation.y = pointer.x * 0.11 + Math.sin(time * 0.00022) * 0.035;
          root.rotation.x = pointer.y * -0.035;
          particles.rotation.y = -pointer.x * 0.1 + time * 0.000025;
          halo.rotation.z = time * 0.00008;
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };

        observer = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting && !frame) frame = requestAnimationFrame(render);
          if (!entry.isIntersecting && frame) { cancelAnimationFrame(frame); frame = 0; }
        }, { threshold: 0.01 });
        observer.observe(mount);
      } catch (error) {
        console.warn("[ZEVROA] Editorial 3D fallback", error);
        setDegraded(true);
      }
    };

    load();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      resizeObserver?.disconnect();
      if (onMove) mount.removeEventListener("pointermove", onMove);
      if (onLeave) mount.removeEventListener("pointerleave", onLeave);
      renderer?.dispose();
      if (renderer?.domElement?.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [reduceMotion]);

  return (
    <div ref={mountRef} className={`studio-hero-object${degraded ? " is-degraded" : ""}`} role="img" aria-label={label}>
      <div className="studio-hero-object-fallback" aria-hidden="true"><span /><i /><b /></div>
      <small className="studio-hero-object-label" aria-hidden="true">CODE / OBJECT 01</small>
    </div>
  );
}
