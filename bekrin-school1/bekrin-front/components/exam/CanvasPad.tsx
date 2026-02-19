"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Pen, Eraser, Undo2, Redo2, Trash2, Maximize2 } from "lucide-react";

const MAX_UNDO = 30;
const PRESET_WIDTHS = [2, 4, 6];

interface CanvasPadProps {
  attemptId: number;
  questionId?: number;
  initialImageUrl?: string | null;
  onSave?: (imageBase64: string) => Promise<void>;
  readOnly?: boolean;
  compact?: boolean;
  maxWidth?: number;
}

export function CanvasPad({
  attemptId,
  questionId,
  initialImageUrl,
  onSave,
  readOnly = false,
  compact = false,
  maxWidth = 1200,
}: CanvasPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [lineWidth, setLineWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const storageKey = `canvas_${attemptId}_${questionId ?? 'default'}`;

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png", 0.92);
    undoStack.current.push(data);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setRedoCount(0);
  }, []);

  const drawImageToCanvas = useCallback((urlOrDataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = urlOrDataUrl.startsWith("data:") ? null : "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = urlOrDataUrl;
  }, []);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = container.getBoundingClientRect();
    let w = Math.max(rect.width || 400, 280);
    w = Math.min(w, maxWidth);
    let h = compact ? 180 : 300;
    if (!compact) {
      h = Math.min(rect.height || 300, 400);
    }
    const cw = Math.floor(w * dpr);
    const ch = Math.floor(h * dpr);
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (initialImageUrl) {
      drawImageToCanvas(initialImageUrl);
    }
  }, [compact, maxWidth, lineWidth, initialImageUrl, drawImageToCanvas]);

  useEffect(() => {
    initCanvas();
    // Load from localStorage on mount
    if (typeof window !== "undefined" && !readOnly) {
      const saved = localStorage.getItem(storageKey);
      if (saved && !initialImageUrl) {
        try {
          drawImageToCanvas(saved);
          undoStack.current.push(saved);
        } catch (e) {
          console.warn("Failed to load canvas from localStorage", e);
        }
      }
    }
  }, [initCanvas, storageKey, readOnly, initialImageUrl, drawImageToCanvas]);

  useEffect(() => {
    if (initialImageUrl && canvasRef.current && undoStack.current.length === 0) {
      drawImageToCanvas(initialImageUrl);
      undoStack.current.push(canvasRef.current.toDataURL("image/png", 0.92));
    }
  }, [initialImageUrl, drawImageToCanvas]);

  const getCoords = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.preventDefault();
    pushUndo();
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "#000000";
    ctx.lineWidth = tool === "eraser" ? lineWidth * 2 : lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || readOnly) return;
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const saveToStorage = useCallback((data: string) => {
    if (typeof window !== "undefined" && !readOnly) {
      try {
        localStorage.setItem(storageKey, data);
      } catch (e) {
        console.warn("Failed to save canvas to localStorage", e);
      }
    }
  }, [storageKey, readOnly]);

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (onSave && canvasRef.current) {
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      // Save to localStorage immediately
      saveToStorage(data);
      
      // Debounced server save (reduced from 1200ms to 2000ms for better debouncing)
      if (lastSaveRef.current) clearTimeout(lastSaveRef.current);
      lastSaveRef.current = setTimeout(() => {
        setSaveStatus("saving");
        onSave(data)
          .then(() => {
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 2000);
            // Clear localStorage after successful save
            if (typeof window !== "undefined") {
              localStorage.removeItem(storageKey);
            }
          })
          .catch(() => setSaveStatus("error"));
        lastSaveRef.current = null;
      }, 2000);
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onUp = () => setIsDrawing(false);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  const handleUndo = () => {
    if (undoStack.current.length <= 1 || readOnly) return;
    redoStack.current.push(undoStack.current.pop()!);
    const prev = undoStack.current[undoStack.current.length - 1];
    if (prev) drawImageToCanvas(prev);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  };

  const handleRedo = () => {
    if (!redoStack.current.length || readOnly) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    drawImageToCanvas(next);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  };

  const handleClear = () => {
    if (readOnly) return;
    pushUndo();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const handleManualSave = () => {
    if (!onSave || !canvasRef.current) return;
    const data = canvasRef.current.toDataURL("image/png", 0.92);
    setSaveStatus("saving");
    onSave(data)
      .then(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        // Clear localStorage after successful save
        if (typeof window !== "undefined") {
          localStorage.removeItem(storageKey);
        }
      })
      .catch(() => setSaveStatus("error"));
  };

  // Expose final save function for submit handler
  useEffect(() => {
    if (canvasRef.current && onSave && !readOnly) {
      // Store final save function on canvas element for external access
      (canvasRef.current as any).finalSave = async () => {
        if (lastSaveRef.current) {
          clearTimeout(lastSaveRef.current);
          lastSaveRef.current = null;
        }
        const data = canvasRef.current!.toDataURL("image/png", 0.92);
        await onSave(data);
        if (typeof window !== "undefined") {
          localStorage.removeItem(storageKey);
        }
      };
    }
  }, [onSave, readOnly, storageKey]);

  const canvasEl = (
    <div
      ref={containerRef}
      className={`relative rounded-lg border border-slate-200 bg-white overflow-hidden ${compact ? "max-h-[180px]" : "min-h-[200px]"}`}
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        data-canvas-pad="true"
        className="block w-full cursor-crosshair touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: readOnly ? "default" : "crosshair" }}
      />
      {!readOnly && (
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={`p-1.5 rounded ${tool === "pen" ? "bg-slate-200" : "hover:bg-slate-100"}`}
            title="Qələm"
          >
            <Pen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setTool("eraser")}
            className={`p-1.5 rounded ${tool === "eraser" ? "bg-slate-200" : "hover:bg-slate-100"}`}
            title="Silgi"
          >
            <Eraser className="w-4 h-4" />
          </button>
          {PRESET_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setLineWidth(w)}
              className={`px-1.5 py-0.5 text-xs rounded ${lineWidth === w ? "bg-slate-200" : "hover:bg-slate-100"}`}
            >
              {w}
            </button>
          ))}
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.current.length <= 1}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="Geri"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="İrəli"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-red-50 text-red-600"
            title="Təmizlə"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onSave && (
            <button
              type="button"
              onClick={handleManualSave}
              disabled={saveStatus === "saving"}
              className="ml-auto text-xs px-2 py-1 rounded bg-primary text-white hover:bg-blue-600 disabled:opacity-60"
            >
              {saveStatus === "saving" ? "Saxlanılır..." : saveStatus === "saved" ? "Saxlanıldı" : "Yadda saxla"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="relative max-w-4xl w-full">
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="absolute -top-10 right-0 text-white hover:underline"
          >
            Bağla
          </button>
          {canvasEl}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {canvasEl}
      {!compact && !readOnly && (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="mt-1 p-1 rounded hover:bg-slate-100 text-slate-500"
          title="Tam ekran"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
