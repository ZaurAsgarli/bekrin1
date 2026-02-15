"use client";

import React, { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi } from "@/lib/teacher";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Download,
  X,
  ChevronRight,
} from "lucide-react";

type PreviewRow = {
  row: number;
  fullName: string;
  grade: string | null;
  phone: string | null;
  status: "valid" | "invalid" | "duplicate_in_file" | "duplicate_in_db";
  message: string | null;
};

type Credential = {
  fullName: string;
  studentEmail: string;
  studentPassword: string;
  parentEmail: string;
  parentPassword: string;
};

type PreviewState = {
  preview: PreviewRow[];
  summary: { total: number; valid: number; invalid: number; duplicateInFile: number; duplicateInDb: number };
  validRows: { full_name: string; grade?: string | null; phone?: string | null }[];
} | null;

type ResultState = { created: number; errors: string[]; credentials: Credential[] } | null;

const STATUS_LABEL: { [k: string]: string } = {
  valid: "Əlavə ediləcək",
  invalid: "Xətalı",
  duplicate_in_file: "Təkrarlanan",
  duplicate_in_db: "Artıq mövcuddur",
};

const STATUS_COLOR: { [k: string]: string } = {
  valid: "text-green-600 bg-green-50",
  invalid: "text-red-600 bg-red-50",
  duplicate_in_file: "text-amber-600 bg-amber-50",
  duplicate_in_db: "text-slate-600 bg-slate-100",
};

export default function BulkImportView() {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [file, setFile] = useState(null as File | null);
  const [preview, setPreview] = useState(null as PreviewState);
  const [result, setResult] = useState(null as ResultState);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const fileInputRef = useRef(null) as { current: HTMLInputElement | null };
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Fayl seçilməyib");
      return teacherApi.bulkImportPreview(file);
    },
    onSuccess: (data: PreviewState) => {
      setPreview(data);
      setShowUploadModal(false);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (rows: { full_name: string; grade?: string | null; phone?: string | null }[]) =>
      teacherApi.bulkImportConfirm(rows),
    onSuccess: (data: ResultState) => {
      if (data) {
        setResult(data);
        setPreview(null);
        setShowCredentialsModal(true);
        queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      }
    },
  });

  const handleFileChange = (e: { target: { files?: FileList | null } }) => {
    const f = e.target.files?.[0];
    const ok = f && (f.name.endsWith(".csv") || f.name.endsWith(".xlsx") || f.name.endsWith(".xls"));
    if (ok) {
      setFile(f);
      setPreview(null);
      setResult(null);
    } else if (f) {
      alert("Yalnız CSV və ya Excel (.xlsx) faylları qəbul olunur");
    }
  };

  const openUploadModal = () => {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setShowUploadModal(true);
  };

  const runPreview = () => {
    if (!file) return;
    previewMutation.mutate();
  };

  const runConfirm = () => {
    if (!preview?.validRows?.length) return;
    confirmMutation.mutate(preview.validRows);
  };

  const downloadCredentialsCsv = () => {
    if (!result?.credentials?.length) return;
    const headers = ["Ad Soyad", "Şagird Email", "Şagird Şifrə", "Valideyn Email", "Valideyn Şifrə"];
    const rows = result.credentials.map((c) => [
      c.fullName,
      c.studentEmail,
      c.studentPassword,
      c.parentEmail,
      c.parentPassword,
    ]);
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? "");
      return "\"" + s.replace(/"/g, "\"\"") + "\"";
    };
    const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "credentials.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const output = (
    <div className="page-container">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Toplu İdxal</h1>
          <p className="text-sm text-slate-600 mt-2">
            CSV və ya Excel faylı ilə toplu şagird əlavə edin. Əvvəlcə önizləmə göstərilir, sonra təsdiq edin.
            Email və şifrələr avtomatik yaradılır.
          </p>
        </div>

        <div className="card max-w-4xl">
          <div className="mb-6">
            <p className="text-sm text-slate-600 mb-2">
              Sütunlar:{" "}
              <code className="bg-slate-100 px-1 rounded">full_name</code> və ya{" "}
              <code className="bg-slate-100 px-1 rounded">fullName</code> (mütləq),{" "}
              <code className="bg-slate-100 px-1 rounded">grade</code>,{" "}
              <code className="bg-slate-100 px-1 rounded">phone</code> (isteğe bağlı)
            </p>
            <p className="text-xs text-slate-500">CSV: UTF-8. Excel: .xlsx formatı.</p>
          </div>

          <button onClick={openUploadModal} className="btn-primary">
            <Upload className="w-4 h-4" />
            Fayl yüklə və önizləmə al
          </button>

          {preview && (
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Önizləmə</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 text-sm">
                <div className="bg-slate-50 rounded px-3 py-2">
                  <span className="text-slate-500">Cəmi</span>
                  <p className="font-medium">{preview.summary.total}</p>
                </div>
                <div className="bg-green-50 rounded px-3 py-2">
                  <span className="text-green-600">Əlavə ediləcək</span>
                  <p className="font-medium text-green-700">{preview.summary.valid}</p>
                </div>
                <div className="bg-red-50 rounded px-3 py-2">
                  <span className="text-red-600">Xətalı</span>
                  <p className="font-medium text-red-700">{preview.summary.invalid}</p>
                </div>
                <div className="bg-amber-50 rounded px-3 py-2">
                  <span className="text-amber-600">Faylda təkrarlanan</span>
                  <p className="font-medium text-amber-700">{preview.summary.duplicateInFile}</p>
                </div>
                <div className="bg-slate-100 rounded px-3 py-2">
                  <span className="text-slate-600">Mövcud şagirdlər</span>
                  <p className="font-medium text-slate-700">{preview.summary.duplicateInDb}</p>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Sətir</th>
                      <th className="text-left p-2">Ad Soyad</th>
                      <th className="text-left p-2">Sinif</th>
                      <th className="text-left p-2">Telefon</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Qeyd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-2">{r.row}</td>
                        <td className="p-2 font-medium">{r.fullName || "—"}</td>
                        <td className="p-2">{r.grade || "—"}</td>
                        <td className="p-2">{r.phone || "—"}</td>
                        <td className="p-2">
                          <span className={"inline-block px-2 py-0.5 rounded text-xs " + (STATUS_COLOR[r.status] || "")}>
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td className="p-2 text-slate-500 text-xs">{r.message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.summary.valid > 0 && (
                <div className="mt-4 flex items-center gap-4">
                  <button
                    onClick={runConfirm}
                    disabled={confirmMutation.isPending}
                    className="btn-primary"
                  >
                    <ChevronRight className="w-4 h-4" />
                    {confirmMutation.isPending ? "Əlavə edilir..." : (preview.summary.valid + " şagird əlavə et")}
                  </button>
                  <button onClick={openUploadModal} className="btn-outline">
                    Başqa fayl yüklə
                  </button>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">{result.created} şagird əlavə edildi</span>
                </div>
                {result.credentials?.length > 0 && (
                  <button onClick={downloadCredentialsCsv} className="btn-outline flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Hesab məlumatlarını endir (CSV)
                  </button>
                )}
              </div>
              {result.errors?.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 text-amber-600 mb-1">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Xətalar:</span>
                  </div>
                  <ul className="text-sm text-slate-600 space-y-1 max-h-24 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-amber-600 mt-4">İlk daxil olanda şifrəni dəyişmək mütləqdir.</p>
            </div>
          )}
        </div>

        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900">Fayl yüklə</h3>
                <button onClick={() => setShowUploadModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                CSV və ya Excel (.xlsx) faylı seçin. Önizləmə göstəriləcək, təsdiq etdikdən sonra şagirdlər əlavə ediləcək.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white file:cursor-pointer"
              />
              {file && (
                <p className="mt-3 text-sm text-slate-600 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
              <div className="mt-6 flex gap-3 justify-end">
                <button onClick={() => setShowUploadModal(false)} className="btn-outline">
                  Ləğv et
                </button>
                <button
                  onClick={runPreview}
                  disabled={!file || previewMutation.isPending}
                  className="btn-primary"
                >
                  {previewMutation.isPending ? "Yüklənir..." : "Önizləmə al"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCredentialsModal && result?.credentials?.length && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center p-6 border-b">
                <h3 className="text-lg font-semibold text-slate-900">Hesab məlumatları</h3>
                <div className="flex gap-2">
                  <button onClick={downloadCredentialsCsv} className="btn-outline flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    CSV endir
                  </button>
                  <button
                    onClick={() => setShowCredentialsModal(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="overflow-auto p-6 flex-1">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-2">Ad Soyad</th>
                        <th className="text-left p-2">Şagird Email</th>
                        <th className="text-left p-2">Şagird Şifrə</th>
                        <th className="text-left p-2">Valideyn Email</th>
                        <th className="text-left p-2">Valideyn Şifrə</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.credentials.map((c, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="p-2 font-medium">{c.fullName}</td>
                          <td className="p-2 font-mono text-xs">{c.studentEmail}</td>
                          <td className="p-2 font-mono text-xs">{c.studentPassword}</td>
                          <td className="p-2 font-mono text-xs">{c.parentEmail}</td>
                          <td className="p-2 font-mono text-xs">{c.parentPassword}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-amber-600 mt-4">Bu məlumatları saxlayın. İlk daxil olanda şifrəni dəyişmək mütləqdir.</p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
  return output;
}
