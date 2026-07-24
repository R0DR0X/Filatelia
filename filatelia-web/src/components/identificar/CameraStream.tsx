'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

interface CameraStreamProps {
  onCapture: (base64Data: string) => void;
  onPermissionError?: (errorMsg: string) => void;
  isProcessing?: boolean;
}

export default function CameraStream({ onCapture, onPermissionError, isProcessing = false }: CameraStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const startCamera = async () => {
    setPermissionError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('WebRTC camera API is not supported in this browser context.');
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setCameraActive(true);
      setCapturedImage(null);
    } catch (err: any) {
      const errMsg = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Permiso de cámara denegado por el usuario.'
        : `No se pudo acceder a la cámara: ${err.message || 'Error desconocido'}`;
      setPermissionError(errMsg);
      setCameraActive(false);
      if (onPermissionError) onPermissionError(errMsg);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setCameraActive(false);
  };

  const captureSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.9);
      setCapturedImage(base64Data);
      stopCamera();
      onCapture(base64Data);
    }
  };

  const retakeSnapshot = () => {
    setCapturedImage(null);
    startCamera();
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="w-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 text-center shadow-xl">
      <canvas ref={canvasRef} className="hidden" />

      {permissionError ? (
        <div className="py-8 px-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
          <h4 className="text-white font-medium text-lg">Acceso a Cámara Bloqueado</h4>
          <p className="text-amber-200/80 text-sm max-w-md mx-auto">{permissionError}</p>
          <p className="text-zinc-400 text-xs">Por favor, utiliza la opción de arrastrar y soltar archivos a continuación.</p>
        </div>
      ) : capturedImage ? (
        <div className="space-y-4">
          <div className="relative w-full max-w-md mx-auto aspect-video rounded-xl overflow-hidden border border-moss-green/40 shadow-inner bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capturedImage} alt="Foto capturada" className="w-full h-full object-contain" />
            <div className="absolute top-3 right-3 bg-moss-green/80 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow">
              <CheckCircle size={14} /> Foto Capturada
            </div>
          </div>
          <button
            onClick={retakeSnapshot}
            disabled={isProcessing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-sm transition-colors"
          >
            <RefreshCw size={16} /> Volver a Capturar
          </button>
        </div>
      ) : cameraActive ? (
        <div className="space-y-4">
          <div className="relative w-full max-w-md mx-auto aspect-video rounded-xl overflow-hidden border border-zinc-700 bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={captureSnapshot}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-xl transition-all shadow-lg"
            >
              <Camera size={18} /> Tomar Foto
            </button>
            <button
              onClick={stopCamera}
              className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="py-8 space-y-4">
          <div className="w-16 h-16 bg-moss-green/10 text-moss-green rounded-full flex items-center justify-center mx-auto">
            <Camera size={32} />
          </div>
          <div>
            <h3 className="text-white font-serif text-xl">Identificar por Cámara Live</h3>
            <p className="text-zinc-400 text-sm mt-1">Activa tu cámara para tomar una foto directa del sello postal.</p>
          </div>
          <button
            onClick={startCamera}
            className="inline-flex items-center gap-2 px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-xl transition-all shadow-lg shadow-moss-green/20"
          >
            <Camera size={18} /> Activar Cámara
          </button>
        </div>
      )}
    </div>
  );
}
