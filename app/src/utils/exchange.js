// Tasa de referencia USD → DOP usada en la conversión estimada que se muestra
// junto al precio (catálogo, ficha, barra de decisión y cotización en PDF).
// Antes vivía repetida como literal `60` en cuatro sitios distintos: si la
// tasa real cambia y se actualiza en unos y se olvida en otros, el catálogo y
// la ficha del mismo vehículo mostrarían dos conversiones distintas al mismo
// comprador. No es la tasa oficial del BCRD — es una referencia aproximada
// para que el comprador dominicano tenga una idea del monto en pesos.
export const USD_TO_DOP_RATE = 60;
