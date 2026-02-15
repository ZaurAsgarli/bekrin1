"use client";

import { useQuery } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";

export default function StudentResultsPage() {
  const { data: results, isLoading } = useQuery({
    queryKey: ["student", "results"],
    queryFn: () => studentApi.getResults(),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Quiz Nəticələrim</h1>
        <p className="text-sm text-slate-600 mt-2">
          Verdiğiniz testlərin nəticələri və qiymətləriniz
        </p>
      </div>

      <div className="card">
        {results && results.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Test Adı
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Xal
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Tarix
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Qrup
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={result.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {result.testName}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className="font-semibold text-slate-900">
                        {result.score}
                      </span>
                      <span className="text-slate-500"> / {result.maxScore}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(result.date).toLocaleDateString("az-AZ")}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {result.groupName || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            Test nəticəsi tapılmadı
          </div>
        )}
      </div>
    </div>
  );
}
