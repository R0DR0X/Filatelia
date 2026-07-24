'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Stamp, Camera, Upload, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import CameraStream from '@/components/identificar/CameraStream';
import ImageDropzone from '@/components/identificar/ImageDropzone';
import MatchResultsGrid, { MatchItem } from '@/components/identificar/MatchResultsGrid';

type StateMachineStatus = 'idle' | 'streaming' | 'captured' | 'processing' | 'success' | 'error';

export default function IdentificarPage() {
  const [status, setStatus] = useState<StateMachineStatus>('idle');
  const [mode, setMode] = useState<'upload' | 'camera'>('upload');
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queryTimeMs, setQueryTimeMs] = useState<number | undefined>(undefined);

  const handleImageCapture = (b64: string) => {
    setBase64Image(b64);
    setStatus('captured');
    setErrorMessage(null);
  };

  const handleFileDrop = (_file: File, b64: string) => {
    setBase64Image(b64);
    setStatus('captured');
    setErrorMessage(null);
  };

  const handleClear = () => {
    setBase64Image(null);
    setMatches([]);
    setStatus('idle');
    setErrorMessage(null);
  };

  const handleIdentify = async () => {
    if (!base64Image) return;

    setStatus('processing');
    setErrorMessage(null);
    const startTime = Date.now();

    try {
      const response = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          topK: 10,
        }),
      });

      const data = await response.json();
      const elapsed = Date.now() - startTime;
      setQueryTimeMs(elapsed);

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al identificar la estampilla.');
      }

      const resultsList: MatchItem[] = data.matches || data.results || [];
      setMatches(resultsList);
      setStatus('success');
    } catch (err: any) {
      console.error('Error identifying stamp:', err);
      setErrorMessage(err.message || 'Ocurrió un error inesperado durante la identificación.');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0906] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-moss-green/10 border border-moss-green/30 rounded-full text-moss-green-light text-xs font-semibold uppercase tracking-wider">
            <Stamp size={14} /> Identificación Multimodal IA
          </div>
          <h1 className="text-4xl md:text-5xl font-serif text-white">
            Identificador Visual de <span className="text-moss-green-light">Sellos</span>
          </h1>
          <p className="text-zinc-400 max-w-2xl mx-auto text-sm md:text-base">
            Captura una foto con tu cámara o arrastra una imagen. La IA generará un vector visual de 1536 dimensiones para buscar coincidencias exactas en el catálogo.
          </p>
        </motion.div>

        {/* Mode Selector Tabs */}
        <div className="flex justify-center border-b border-zinc-800 pb-4">
          <div className="inline-flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
            <button
              onClick={() => { setMode('upload'); handleClear(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                mode === 'upload'
                  ? 'bg-moss-green text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Upload size={16} /> Subir Imagen
            </button>
            <button
              onClick={() => { setMode('camera'); handleClear(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                mode === 'camera'
                  ? 'bg-moss-green text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Camera size={16} /> Usar Cámara Live
            </button>
          </div>
        </div>

        {/* Input Area */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {mode === 'camera' ? (
            <CameraStream
              onCapture={handleImageCapture}
              isProcessing={status === 'processing'}
            />
          ) : (
            <ImageDropzone
              onFileSelect={handleFileDrop}
              onClear={handleClear}
            />
          )}

          {/* Action Trigger Button */}
          {base64Image && (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleIdentify}
                disabled={status === 'processing'}
                className={`w-full max-w-md py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 shadow-lg ${
                  status === 'processing'
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-moss-green hover:bg-moss-green-dark text-white shadow-moss-green/20'
                }`}
              >
                {status === 'processing' ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Buscando Coincidencias en Vectorize...
                  </>
                ) : (
                  <>
                    <Stamp size={20} />
                    Identificar Sello Postal
                  </>
                )}
              </button>
            </div>
          )}
        </motion.div>

        {/* Error Feedback */}
        {status === 'error' && errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-center space-y-2"
          >
            <AlertCircle size={28} className="text-red-400 mx-auto" />
            <h4 className="text-white font-medium text-lg">Error de Identificación</h4>
            <p className="text-red-300/80 text-sm max-w-lg mx-auto">{errorMessage}</p>
            <button
              onClick={handleIdentify}
              className="inline-flex items-center gap-2 text-xs font-semibold text-moss-green-light hover:underline pt-2"
            >
              <RefreshCw size={14} /> Reintentar Búsqueda
            </button>
          </motion.div>
        )}

        {/* Results Output */}
        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <MatchResultsGrid results={matches} queryTimeMs={queryTimeMs} />
          </motion.div>
        )}
      </div>
    </div>
  );
}
