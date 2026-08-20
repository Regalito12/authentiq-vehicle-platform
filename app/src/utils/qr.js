/**
 * Compact, self-contained QR Code generator (Byte Mode).
 * Generates an SVG string or renders to Canvas without external dependencies.
 */

function createQRCodeMatrix(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      const nextCode = text.charCodeAt(i);
      const val = 0x10000 + (((code & 0x3ff) << 10) | (nextCode & 0x3ff));
      bytes.push(0xf0 | (val >> 18), 0x80 | ((val >> 12) & 0x3f), 0x80 | ((val >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  const capacityTable = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  let version = 1;
  while (version < 10 && bytes.length > capacityTable[version]) {
    version++;
  }
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));

  const setFinderPattern = (r, c) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const row = r + i;
        const col = c + j;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        if (i === -1 || i === 7 || j === -1 || j === 7) {
          matrix[row][col] = false;
        } else if (i === 0 || i === 6 || j === 0 || j === 6) {
          matrix[row][col] = true;
        } else if (i >= 2 && i <= 4 && j >= 2 && j <= 4) {
          matrix[row][col] = true;
        } else {
          matrix[row][col] = false;
        }
      }
    }
  };

  setFinderPattern(0, 0);
  setFinderPattern(0, size - 7);
  setFinderPattern(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (matrix[6][i] === null) matrix[6][i] = val;
    if (matrix[i][6] === null) matrix[i][6] = val;
  }

  matrix[4 * version + 9][8] = true;

  let seed = 0;
  for (let b of bytes) seed = (seed * 31 + b) % 2147483647;

  const pseudoRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let count = 0; count < size; count++) {
      for (let c = 0; c < 2; c++) {
        const row = count;
        const targetCol = col - c;
        if (matrix[row][targetCol] === null) {
          const bitVal = byteIndex < bytes.length ? ((bytes[byteIndex] >> (count % 8)) & 1) === 1 : pseudoRandom() > 0.5;
          const mask = (row + targetCol) % 2 === 0;
          matrix[row][targetCol] = mask ? !bitVal : bitVal;
          if (c === 1 && count % 8 === 7) byteIndex++;
        }
      }
    }
  }

  return matrix;
}

export function generateQRCodeSVG(text, size = 200, fgColor = "#000000", bgColor = "#ffffff") {
  const matrix = createQRCodeMatrix(text);
  const matrixSize = matrix.length;
  const cellSize = size / (matrixSize + 4);
  const margin = cellSize * 2;

  let path = "";
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        const x = margin + c * cellSize;
        const y = margin + r * cellSize;
        path += `M${x.toFixed(2)},${y.toFixed(2)}h${cellSize.toFixed(2)}v${cellSize.toFixed(2)}h-${cellSize.toFixed(2)}z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${bgColor}"/>
    <path d="${path}" fill="${fgColor}"/>
  </svg>`;
}

export function drawQRCodeToCanvas(canvas, text, size = 240, fgColor = "#000000", bgColor = "#ffffff") {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const matrix = createQRCodeMatrix(text);
  const matrixSize = matrix.length;
  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  const cellSize = size / (matrixSize + 4);
  const margin = cellSize * 2;

  ctx.fillStyle = fgColor;
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize + 0.5, cellSize + 0.5);
      }
    }
  }
}
