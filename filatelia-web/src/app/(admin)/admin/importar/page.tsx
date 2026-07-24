"use client";

import { useState, useRef } from "react";
import { FileUp, AlertCircle, CheckCircle2, Loader2, FileSpreadsheet, Download } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function ImportPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; inserted: number; errors: string[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setResult(null);
      parseExcelPreview(e.target.files[0]);
    }
  };

  const parseExcelPreview = async (file: File) => {
    try {
      const XLSX = (await import("xlsx")).default;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      setPreview(data.slice(0, 11));
    } catch {
      setPreview(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setResult(null);

    try {
      const XLSX = (await import("xlsx")).default;
      const buf = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as any[];

      if (rows.length === 0) {
        setResult({ success: false, inserted: 0, errors: ["El archivo está vacío"] });
        setIsUploading(false);
        return;
      }

      const batchSize = 50;
      let inserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize).map((row: any) => ({
          source: "import",
          countryCode: row.countryCode || row["Country Code"] || null,
          year: row.year || row.Year ? parseInt(row.year || row.Year) : null,
          denomination: row.denomination || row.Denomination ? parseFloat(row.denomination || row.Denomination) : null,
          currency: row.currency || row.Currency || null,
          nameEs: row.nameEs || row["Nombre ES"] || row.name || null,
          nameEn: row.nameEn || row["Nombre EN"] || row.name || null,
          wnsNumber: row.wnsNumber || row["WNS"] || null,
          scottNumber: row.scottNumber || row["Scott"] || null,
          theme: row.theme || row.Theme || null,
        }));

        const token = localStorage.getItem("fp_token");
        const res = await fetch(`${API}/import-stamp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(batch),
        });
        const data = await res.json();
        if (data.success) {
          inserted += data.inserted || batch.length;
        } else {
          errors.push(data.error || `Error en batch ${i / batchSize + 1}`);
        }
      }

      setResult({ success: errors.length === 0, inserted, errors });
    } catch (error: any) {
      setResult({ success: false, inserted: 0, errors: [error.message || "Error procesando archivo"] });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="bg-zinc-900 border border-white/5 rounded-xl p-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-moss-green/20 rounded-full flex items-center justify-center text-moss-green-light">
            <FileUp size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Importar Catálogo desde Excel</h2>
            <p className="text-zinc-500 text-sm">Sube un archivo .xlsx para importar estampillas en lote.</p>
          </div>
        </div>

        <div className="border-2 border-dashed border-zinc-800 rounded-lg p-12 text-center hover:border-moss-green/50 transition-colors cursor-pointer group relative mb-6" onClick={() => fileInputRef.current?.click()}>
          <input ref={fileInputRef} type="file" className="hidden" id="excel-upload" accept=".xlsx" onChange={handleFileChange} />
          {selectedFile ? (
            <div>
              <FileSpreadsheet className="mx-auto mb-4 text-moss-green-light" size={48} />
              <p className="text-white font-bold">{selectedFile.name}</p>
              <p className="text-xs text-zinc-500 mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <>
              <FileUp className="mx-auto mb-4 text-zinc-600 group-hover:text-moss-green-light transition-colors" size={48} />
              <p className="text-zinc-400">Haz clic para seleccionar o arrastra el archivo aquí</p>
              <p className="text-xs text-zinc-600 mt-2">Solo archivos .xlsx</p>
            </>
          )}
        </div>

        {/* Preview table */}
        {preview && preview.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <h4 className="text-sm font-bold text-zinc-400 mb-3">Vista previa (primeras 10 filas)</h4>
            <table className="w-full text-xs bg-zinc-950 rounded-lg overflow-hidden">
              <thead>
                <tr className="border-b border-white/10">
                  {preview[0]?.map((h: any, i: number) => (
                    <th key={i} className="text-left p-2 text-zinc-500 font-bold">{String(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1, 11).map((row: any[], i: number) => (
                  <tr key={i} className="border-b border-white/5">
                    {row.map((cell: any, j: number) => (
                      <td key={j} className="p-2 text-zinc-400">{String(cell ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-lg border border-white/5">
          <div className="text-sm text-zinc-500 flex items-center gap-2">
            <Download size={14} />
            <a href="/07_Ejemplo_Excel_de_Carga.xlsx" className="text-moss-green-light hover:underline">Descargar plantilla</a>
          </div>
          <button onClick={handleUpload} disabled={!selectedFile || isUploading} className="px-6 py-2 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-md flex items-center gap-2 disabled:opacity-50">
            {isUploading ? <Loader2 className="animate-spin" size={18} /> : "INICIAR IMPORTACIÓN"}
          </button>
        </div>

        {result && (
          <div className={`mt-8 p-6 rounded-lg border ${result.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <div className="flex items-center gap-3 mb-2">
              {result.success ? <CheckCircle2 className="text-green-500" /> : <AlertCircle className="text-red-500" />}
              <h3 className="font-bold">{result.success ? "Importación Completada" : "Error en la importación"}</h3>
            </div>
            <p className="text-sm text-zinc-400">Se procesaron {result.inserted} filas correctamente.</p>
            {result.errors.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-red-400">
                {result.errors.map((err, i) => <li key={i}>• {err}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-zinc-900 border border-white/5 rounded-xl">
          <h4 className="font-bold mb-2 flex items-center gap-2"><AlertCircle size={16} className="text-yellow-500" /> Instrucciones</h4>
          <ul className="text-xs text-zinc-500 space-y-2 list-disc pl-4">
            <li>La primera fila debe contener nombres de columna.</li>
            <li>Columnas requeridas: countryCode, name, year</li>
            <li>Se procesan hasta 50 filas por lote.</li>
          </ul>
        </div>
        <div className="p-6 bg-zinc-900 border border-white/5 rounded-xl">
          <h4 className="font-bold mb-2">Última Importación</h4>
          <div className="text-xs text-zinc-500">
            <div className="flex justify-between py-1 border-b border-white/5"><span>Estado:</span><span className="text-green-500 font-bold">LISTO</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
