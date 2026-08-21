// Corrige 3 inconsistencias foto/dato encontradas en la auditoría QA del 2026-08-21:
// BMW M4 (foto principal no coincide con el color), Mercedes-AMG GT 63 (segunda foto es
// otro modelo con marcas de una hoja de specs sin terminar), Porsche 911 GT3 RS (color
// y varios campos de texto decían "GT3" sin "RS"). Idempotente: seguro de correr más de una vez.
//
//   node scripts/fix-vehicle-data-accuracy.mjs
//
// Requiere DATABASE_URL en el entorno (mismo .env que usa el servidor). Correr esto contra
// la base de producción (Supabase) requiere su propio DATABASE_URL de producción.
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bmw = await client.query("SELECT id FROM vehicles WHERE model='M4 Competition xDrive' LIMIT 1");
    if (bmw.rowCount) {
      const id = bmw.rows[0].id;
      const images = await client.query("SELECT id, image_url FROM vehicle_images WHERE vehicle_id=$1 ORDER BY sort_order", [id]);
      const black = images.rows.find((row) => row.image_url.includes("bmw-m4-2"));
      const silver = images.rows.find((row) => row.image_url.includes("bmw-m4") && !row.image_url.includes("bmw-m4-2"));
      if (black && silver) {
        await client.query("UPDATE vehicle_images SET sort_order=0 WHERE id=$1", [black.id]);
        await client.query("UPDATE vehicle_images SET sort_order=1 WHERE id=$1", [silver.id]);
        console.log("BMW M4: foto negra (coincide con 'Negro Zafiro') ahora es la principal.");
      }
    }

    const amg = await client.query("SELECT id FROM vehicles WHERE model='GT 63' LIMIT 1");
    if (amg.rowCount) {
      const id = amg.rows[0].id;
      const removed = await client.query("DELETE FROM vehicle_images WHERE vehicle_id=$1 AND image_url LIKE '%amg-gt.jpg%' RETURNING image_url", [id]);
      if (removed.rowCount) console.log("AMG GT 63: eliminada la foto de un modelo distinto con marcas de medición sin terminar:", removed.rows[0].image_url);
    }

    const gt3rs = await client.query("SELECT id FROM vehicles WHERE model='911 GT3 RS' LIMIT 1");
    if (gt3rs.rowCount) {
      const id = gt3rs.rows[0].id;
      await client.query("UPDATE vehicles SET exterior_color='Blanco', stock_number=REPLACE(stock_number, 'AUT-911-GT3', 'AUT-911-GT3RS'), seo_title=REPLACE(seo_title, 'Porsche 911 GT3 2026', 'Porsche 911 GT3 RS 2026') WHERE id=$1", [id]);
      await client.query("UPDATE vehicle_media SET alt_text='Porsche 911 GT3 RS, modelo 3D' WHERE vehicle_id=$1", [id]);
      await client.query("UPDATE vehicle_images SET alt_text=REPLACE(alt_text, 'Porsche 911 GT3 2026', 'Porsche 911 GT3 RS 2026') WHERE vehicle_id=$1", [id]);
      console.log("911 GT3 RS: color corregido a Blanco, 'RS' agregado en stock_number/seo_title/alt_text.");
    }

    await client.query("COMMIT");
    console.log("Listo.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Fallo, se revirtió todo:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
