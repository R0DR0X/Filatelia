'use client';

import React, { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, X, AlertCircle } from 'lucide-react';
import Image from 'next/image';

interface ImageDropzoneProps {
  onFileSelect: (file: File, base64: string) => void;
  onClear?: () => void;
  maxSizeBytes?: number;
}

export default function ImageDropzone({
  onFileSelect,
  onClear,
  maxSizeBytes = 10 * 1024 * 1024, // 10MB
}: ImageDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const processSelectedFile = (file: File) => {
    setValidationError(null);

    if (!file.type.startsWith('image/')) {
      setValidationError('El archivo seleccionado no es una imagen válida.');
      return;
    }

    if (file.size > maxSizeBytes) {
      setValidationError(`El tamaño de la imagen supera el límite máximo de ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`);
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setPreviewUrl(base64);
      onFileSelect(file, base64);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processSelectedFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSelectedFile(file);
  };

  const handleClear = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedFile(null);
    setPreviewUrl(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (onClear) onClear();
  };

  return (
    <div className="w-full">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
          previewUrl
            ? 'border-moss-green bg-moss-green/5'
            : 'border-zinc-700 hover:border-moss-green/60 bg-zinc-900/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {previewUrl ? (
          <div className="space-y-4">
            <div className="relative w-48 h-48 mx-auto bg-black/60 rounded-xl overflow-hidden border border-moss-green/30 p-2 shadow-md">
              <Image src={previewUrl} alt="Vistazo previo" fill className="object-contain p-2" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-medium text-zinc-300 truncate max-w-xs">{selectedFile?.name}</span>
              <span className="text-xs text-zinc-500">
                ({selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : 0} MB)
              </span>
            </div>
            <button
              onClick={handleClear}
              type="button"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-red-400 transition-colors px-3 py-1 bg-zinc-800 rounded-full"
            >
              <X size={14} /> Cambiar Imagen
            </button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="w-16 h-16 bg-moss-green/10 text-moss-green rounded-full flex items-center justify-center mx-auto">
              <Upload size={28} />
            </div>
            <div>
              <p className="text-white font-serif text-lg">Arrastra tu imagen aquí</p>
              <p className="text-zinc-400 text-sm mt-1">o haz clic para explorar en tu dispositivo</p>
            </div>
            <p className="text-xs text-zinc-500">Soporta PNG, JPG, WEBP de hasta 10MB</p>
          </div>
        )}
      </div>

      {validationError && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>{validationError}</span>
        </div>
      )}
    </div>
  );
}
