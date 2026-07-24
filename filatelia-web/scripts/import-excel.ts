import { prisma } from "../src/lib/prisma";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

async function runImport() {
  const args = process.argv.slice(2);
  const filePath = args[0] || "plantilla_importacion_filatelia.xlsx";
  
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`📖 Reading Excel file from ${absolutePath}...`);
  const buffer = fs.readFileSync(absolutePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet) as any[];

  console.log(`🚀 Starting import of ${data.length} rows...`);

  let processedCount = 0;
  let errorCount = 0;

  for (const row of data) {
    try {
      const catalogName = row["Catálogo"] || "Sin Categoría";
      const groupTitle = row["Grupo"] || "General";
      const stampTitle = row["Título ES"];
      const year = parseInt(row["Año"]);

      if (!stampTitle) continue;

      // 1. Ensure Catalog
      const catalog = await prisma.catalog.upsert({
        where: { name: catalogName },
        update: {},
        create: { name: catalogName }
      });

      // 2. Ensure Group
      const group = await prisma.stampGroup.upsert({
        where: { 
          catalogId_titleEs: {
            catalogId: catalog.id,
            titleEs: groupTitle
          }
        },
        update: {},
        create: {
          titleEs: groupTitle,
          catalogId: catalog.id,
          year: year || null
        }
      });

      // 3. Create Stamp
      const stamp = await prisma.stamp.create({
        data: {
          groupId: group.id,
          titleEs: stampTitle,
          titleEn: row["Título EN"],
          issueDate: year ? new Date(year, 0, 1) : null,
          faceValue: row["Valor Facial"],
          color: row["Color"],
          catalogNumbers: {
            create: [
              ...(row["Scott"] ? [{ catalogName: "Scott", number: String(row["Scott"]) }] : []),
              ...(row["Yvert"] ? [{ catalogName: "Yvert", number: String(row["Yvert"]) }] : []),
              ...(row["Michel"] ? [{ catalogName: "Michel", number: String(row["Michel"]) }] : []),
            ]
          }
        }
      });

      // 4. If price is present, create store product
      if (row["Precio Venta"]) {
        await prisma.product.create({
          data: {
            stampId: stamp.id,
            name: stampTitle,
            price: parseFloat(row["Precio Venta"]),
            stock: parseInt(row["Stock"]) || 0,
            status: "ACTIVE"
          }
        });
      }

      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`✅ Processed ${processedCount} / ${data.length} rows`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`❌ Error on row ${processedCount + 1}:`, error.message);
    }
  }

  console.log(`\n🎉 Import finished! Successfully processed: ${processedCount}, errors: ${errorCount}`);
}

runImport().catch((err) => {
  console.error("❌ Fatal error during import:", err);
  process.exit(1);
});
