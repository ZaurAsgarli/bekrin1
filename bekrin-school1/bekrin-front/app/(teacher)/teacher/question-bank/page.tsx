"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, QuestionBankItem, TeacherPDF } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useDebounce } from "@/lib/useDebounce";
import Link from "next/link";
import { Plus, Trash2, ChevronRight, Edit2, Search, Upload, FileText, Eye, Archive } from "lucide-react";
import { API_BASE_URL } from "@/lib/constants";

const PAGE_SIZE = 10;
const QUESTION_TYPES = [
  { value: "MULTIPLE_CHOICE", label: "Çox variantlı" },
  { value: "OPEN_SINGLE_VALUE", label: "Açıq (tək cavab)" },
  { value: "OPEN_ORDERED", label: "Açıq (sıralı)" },
  { value: "OPEN_UNORDERED", label: "Açıq (sırasız)" },
  { value: "SITUATION", label: "Situasiya" },
] as const;
const ANSWER_RULES: { value: string; label: string }[] = [
  { value: "EXACT_MATCH", label: "Dəqiq uyğun" },
  { value: "ORDERED_MATCH", label: "Sıralı uyğun" },
  { value: "UNORDERED_MATCH", label: "Sırasız uyğun" },
  { value: "NUMERIC_EQUAL", label: "Rəqəmsal bərabər" },
  { value: "ORDERED_DIGITS", label: "Ardıcıllıq vacibdir (135)" },
  { value: "UNORDERED_DIGITS", label: "Ardıcıllıq vacib deyil (1,3,5)" },
];
const OPEN_QUESTION_HINTS: Record<string, string> = {
  ORDERED_DIGITS: "Məs: 1,3,5 və ya 135",
  UNORDERED_DIGITS: "Məs: 1,3,5 (sıra fərqi önəmsiz)",
  NUMERIC_EQUAL: "Məs: 15 və ya 15.0",
};

export default function QuestionBankPage() {
  const [topicPage, setTopicPage] = useState(1);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [showEditQuestion, setShowEditQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionBankItem | null>(null);
  const [showRenameTopic, setShowRenameTopic] = useState(false);
  const [renamingTopicId, setRenamingTopicId] = useState<number | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [topicSearch, setTopicSearch] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [questionTypeFilter, setQuestionTypeFilter] = useState("");
  const [showUploadPDF, setShowUploadPDF] = useState(false);
  const [pdfSearch, setPdfSearch] = useState("");
  const [pdfYearFilter, setPdfYearFilter] = useState("");
  
  const debouncedTopicSearch = useDebounce(topicSearch, 300);
  const debouncedQuestionSearch = useDebounce(questionSearch, 300);
  const debouncedPdfSearch = useDebounce(pdfSearch, 300);
  const [newPDF, setNewPDF] = useState({ title: "", year: "", tags: "", source: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [newQ, setNewQ] = useState({
    text: "",
    type: "MULTIPLE_CHOICE" as string,
    answer_rule_type: "" as string,
    correct_answer: "",
    options: [] as { text: string; is_correct: boolean }[],
  });
  const queryClient = useQueryClient();

  const { data: topics = [], isLoading: topicsLoading } = useQuery({
    queryKey: ["teacher", "question-topics"],
    queryFn: () => teacherApi.getQuestionTopics(),
    staleTime: 60 * 1000, // Cache topics for 1 minute
  });
  const { data: allQuestionsForCounts = [] } = useQuery({
    queryKey: ["teacher", "questions", "all"],
    queryFn: () => teacherApi.getQuestions(),
    staleTime: 30 * 1000, // Cache for 30 seconds
  });
  const { data: pdfs = [], isLoading: pdfsLoading } = useQuery({
    queryKey: ["teacher", "pdfs", debouncedPdfSearch, pdfYearFilter],
    queryFn: () => teacherApi.getPDFs({
      ...(debouncedPdfSearch ? { q: debouncedPdfSearch } : {}),
      ...(pdfYearFilter ? { year: pdfYearFilter } : {}),
    }),
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  const { data: allQuestions = [], isLoading: questionsLoading } = useQuery({
    queryKey: ["teacher", "questions", selectedTopicId, questionTypeFilter],
    queryFn: () => teacherApi.getQuestions({
      ...(selectedTopicId != null ? { topic: String(selectedTopicId) } : {}),
      ...(questionTypeFilter ? { type: questionTypeFilter } : {}),
    }),
    enabled: selectedTopicId != null,
  });

  const filteredTopics = useMemo(() => {
    if (!debouncedTopicSearch.trim()) return topics;
    return topics.filter((t) => t.name.toLowerCase().includes(debouncedTopicSearch.toLowerCase()));
  }, [topics, debouncedTopicSearch]);

  const filteredQuestions = useMemo(() => {
    let qs = allQuestions;
    if (debouncedQuestionSearch.trim()) {
      qs = qs.filter((q) => q.text.toLowerCase().includes(debouncedQuestionSearch.toLowerCase()));
    }
    return qs;
  }, [allQuestions, debouncedQuestionSearch]);

  const topicQuestionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    allQuestionsForCounts.forEach((q) => {
      counts[q.topic] = (counts[q.topic] || 0) + 1;
    });
    return counts;
  }, [allQuestionsForCounts]);

  const createTopicMutation = useMutation({
    mutationFn: (name: string) => teacherApi.createQuestionTopic({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "question-topics"] });
      setShowCreateTopic(false);
      setNewTopicName("");
    },
  });
  const deleteTopicMutation = useMutation({
    mutationFn: (id: number) => teacherApi.deleteQuestionTopic(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "question-topics"] });
      if (selectedTopicId) setSelectedTopicId(null);
    },
  });
  const createQuestionMutation = useMutation({
    mutationFn: () => {
      if (selectedTopicId == null) throw new Error("Mövzu seçilməyib");
      const payload: Parameters<typeof teacherApi.createQuestion>[0] = {
        topic: selectedTopicId,
        text: newQ.text,
        type: newQ.type as "MULTIPLE_CHOICE" | "OPEN_SINGLE_VALUE" | "OPEN_ORDERED" | "OPEN_UNORDERED" | "SITUATION",
        is_active: true,
      };
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length) {
        payload.options = newQ.options.map((o, i) => ({ text: o.text, is_correct: o.is_correct, order: i }));
      } else if (["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED"].includes(newQ.type) && newQ.correct_answer) {
        payload.correct_answer = newQ.correct_answer;
        const rule = newQ.answer_rule_type || (newQ.type === "OPEN_ORDERED" ? "ORDERED_DIGITS" : newQ.type === "OPEN_UNORDERED" ? "UNORDERED_DIGITS" : "NUMERIC_EQUAL");
        if (rule) payload.answer_rule_type = rule;
      }
      return teacherApi.createQuestion(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setShowCreateQuestion(false);
      setNewQ({ text: "", type: "MULTIPLE_CHOICE", answer_rule_type: "", correct_answer: "", options: [] });
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: (id: number) => {
      if (selectedTopicId == null) throw new Error("Mövzu seçilməyib");
      const payload: Record<string, unknown> = {
        text: newQ.text,
        type: newQ.type,
      };
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length) {
        payload.options = newQ.options.map((o, i) => ({ text: o.text, is_correct: o.is_correct, order: i }));
      } else if (["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED"].includes(newQ.type) && newQ.correct_answer) {
        payload.correct_answer = newQ.correct_answer;
        const rule = newQ.answer_rule_type || (newQ.type === "OPEN_ORDERED" ? "ORDERED_DIGITS" : newQ.type === "OPEN_UNORDERED" ? "UNORDERED_DIGITS" : "NUMERIC_EQUAL");
        if (rule) payload.answer_rule_type = rule;
      }
      return teacherApi.updateQuestion(id, payload as Partial<QuestionBankItem>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setShowEditQuestion(false);
      setEditingQuestion(null);
      setNewQ({ text: "", type: "MULTIPLE_CHOICE", answer_rule_type: "", correct_answer: "", options: [] });
    },
  });

  const uploadPDFMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("Fayl seçilməyib");
      const tags = newPDF.tags ? newPDF.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      return teacherApi.uploadPDF(uploadFile, {
        title: newPDF.title || uploadFile.name,
        year: newPDF.year ? parseInt(newPDF.year) : undefined,
        tags,
        source: newPDF.source || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "pdfs"] });
      setShowUploadPDF(false);
      setUploadFile(null);
      setNewPDF({ title: "", year: "", tags: "", source: "" });
    },
  });
  const deletePDFMutation = useMutation({
    mutationFn: (id: number) => teacherApi.deletePDF(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "pdfs"] });
    },
  });

  const handleEditQuestion = (q: QuestionBankItem) => {
    setEditingQuestion(q);
    const options = q.options?.map((opt) => ({ text: opt.text, is_correct: opt.is_correct || false })) || [];
    // If MULTIPLE_CHOICE and correct_answer is option_id, mark the correct option
    if (q.type === "MULTIPLE_CHOICE" && q.correct_answer) {
      let correctId: number | null = null;
      if (typeof q.correct_answer === "object" && q.correct_answer !== null && "option_id" in q.correct_answer) {
        correctId = (q.correct_answer as any).option_id;
      } else if (typeof q.correct_answer === "number") {
        correctId = q.correct_answer;
      }
      if (correctId !== null) {
        options.forEach((opt, idx) => {
          const origOpt = q.options?.[idx];
          if (origOpt && origOpt.id === correctId) {
            opt.is_correct = true;
          } else {
            opt.is_correct = false;
          }
        });
      }
    }
    setNewQ({
      text: q.text,
      type: q.type,
      answer_rule_type: q.answer_rule_type || "",
      correct_answer: typeof q.correct_answer === "string" ? q.correct_answer : (q.correct_answer ? String(q.correct_answer) : ""),
      options,
    });
    setShowEditQuestion(true);
  };


  const addOption = () => setNewQ((q) => ({ ...q, options: [...q.options, { text: "", is_correct: false }] }));
  const setOption = (i: number, text: string, is_correct: boolean) =>
    setNewQ((q) => ({
      ...q,
      options: q.options.map((o, j) => (j === i ? { text, is_correct } : { ...o, is_correct: j === i ? is_correct : false })),
    }));
  const removeOption = (i: number) => setNewQ((q) => ({ ...q, options: q.options.filter((_, j) => j !== i) }));

  if (topicsLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Sual bankı</h1>
        <div className="flex gap-2">
          <Link href="/teacher/tests?tab=archive" className="btn-outline flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Arxiv
          </Link>
          <button onClick={() => setShowCreateTopic(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Yeni mövzu
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card md:col-span-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Mövzular</h2>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                className="input pl-8 w-full text-sm"
                placeholder="Mövzu axtar..."
                value={topicSearch}
                onChange={(e) => setTopicSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="space-y-2">
            {filteredTopics.slice((topicPage - 1) * PAGE_SIZE, topicPage * PAGE_SIZE).map((t) => (
              <li
                key={t.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  selectedTopicId === t.id ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedTopicId(t.id)}
                  className="flex-1 text-left font-medium text-slate-900 flex items-center gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-slate-500">({topicQuestionCounts[t.id] || 0})</span>
                </button>
                <button
                  type="button"
                  onClick={() => confirm("Bu mövzunu silmək istədiyinizə əminsiniz?") && deleteTopicMutation.mutate(t.id)}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          {Math.ceil(filteredTopics.length / PAGE_SIZE) > 1 && (
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={topicPage <= 1}
                onClick={() => setTopicPage((p) => p - 1)}
                className="btn-outline text-sm"
              >
                Əvvəlki
              </button>
              <span className="self-center text-sm text-slate-500">
                {topicPage} / {Math.ceil(filteredTopics.length / PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={topicPage >= Math.ceil(filteredTopics.length / PAGE_SIZE)}
                onClick={() => setTopicPage((p) => p + 1)}
                className="btn-outline text-sm"
              >
                Növbəti
              </button>
            </div>
          )}
        </div>

        <div className="card md:col-span-2">
          {selectedTopicId == null ? (
            <p className="text-slate-500 py-8 text-center">Mövzu seçin</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Suallar ({filteredQuestions.length})
                </h2>
                <button
                  onClick={() => {
                    setNewQ({ text: "", type: "MULTIPLE_CHOICE", answer_rule_type: "", correct_answer: "", options: [] });
                    setShowCreateQuestion(true);
                  }}
                  className="btn-primary text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Yeni sual
                </button>
              </div>
              <div className="mb-4 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    className="input pl-8 w-full text-sm"
                    placeholder="Sual axtar..."
                    value={questionSearch}
                    onChange={(e) => setQuestionSearch(e.target.value)}
                  />
                </div>
                <select
                  className="input text-sm"
                  value={questionTypeFilter}
                  onChange={(e) => setQuestionTypeFilter(e.target.value)}
                >
                  <option value="">Bütün tiplər</option>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {questionsLoading ? (
                <p className="text-slate-500">Yüklənir...</p>
              ) : filteredQuestions.length === 0 ? (
                <p className="text-slate-500 py-8 text-center">Bu mövzuda sual tapılmadı</p>
              ) : (
                <ul className="space-y-3">
                  {filteredQuestions.map((q) => (
                    <li key={q.id} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 cursor-pointer" onClick={() => handleEditQuestion(q)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-slate-900 line-clamp-2">{q.text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">{q.type}</span>
                            {q.created_at && (
                              <span className="text-xs text-slate-400">
                                {new Date(q.created_at).toLocaleDateString("az-AZ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleEditQuestion(q); }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <Modal isOpen={showCreateTopic} onClose={() => setShowCreateTopic(false)} title="Yeni mövzu">
        <div className="space-y-4">
          <div>
            <label className="label">Ad *</label>
            <input
              className="input w-full"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="Mövzu adı"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => createTopicMutation.mutate(newTopicName)}
              disabled={!newTopicName.trim() || createTopicMutation.isPending}
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateTopic(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showEditQuestion} onClose={() => { setShowEditQuestion(false); setEditingQuestion(null); }} title="Sualı redaktə et" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Sual mətni *</label>
            <textarea
              className="input w-full h-24"
              value={newQ.text}
              onChange={(e) => setNewQ((q) => ({ ...q, text: e.target.value }))}
              placeholder="Sualı yazın..."
            />
          </div>
          <div>
            <label className="label">Tip</label>
            <select
              className="input w-full"
              value={newQ.type}
              onChange={(e) => setNewQ((q) => ({ ...q, type: e.target.value }))}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {newQ.type === "MULTIPLE_CHOICE" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">Variantlar (düzgün olanı işarələyin)</label>
                <button type="button" onClick={addOption} className="text-sm text-blue-600">
                  + Variant
                </button>
              </div>
              {newQ.options.map((opt, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="radio"
                    name="correct-edit"
                    checked={opt.is_correct}
                    onChange={() => setOption(i, opt.text, true)}
                  />
                  <input
                    className="input flex-1"
                    value={opt.text}
                    onChange={(e) => setOption(i, e.target.value, opt.is_correct)}
                    placeholder={`Variant ${i + 1}`}
                  />
                  <button type="button" onClick={() => removeOption(i)} className="text-red-600">Sil</button>
                </div>
              ))}
            </div>
          )}
          {(newQ.type === "OPEN_SINGLE_VALUE" || newQ.type.startsWith("OPEN_")) && (
            <>
              <div>
                <label className="label">Açıq sual tipi</label>
                <select
                  className="input w-full"
                  value={newQ.answer_rule_type || (newQ.type === "OPEN_ORDERED" ? "ORDERED_DIGITS" : newQ.type === "OPEN_UNORDERED" ? "UNORDERED_DIGITS" : "NUMERIC_EQUAL")}
                  onChange={(e) => setNewQ((q) => ({ ...q, answer_rule_type: e.target.value }))}
                >
                  <option value="">Seçin</option>
                  <option value="ORDERED_DIGITS">Ardıcıllıq vacibdir (135)</option>
                  <option value="UNORDERED_DIGITS">Ardıcıllıq vacib deyil (1,3,5)</option>
                  <option value="NUMERIC_EQUAL">Rəqəm nəticə (15)</option>
                  {ANSWER_RULES.filter((r) => !["ORDERED_DIGITS", "UNORDERED_DIGITS", "NUMERIC_EQUAL"].includes(r.value)).map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Düzgün cavab</label>
                <input
                  className="input w-full"
                  value={newQ.correct_answer}
                  onChange={(e) => setNewQ((q) => ({ ...q, correct_answer: e.target.value }))}
                  placeholder={OPEN_QUESTION_HINTS[newQ.answer_rule_type || ""] || "Düzgün cavab"}
                />
                {(newQ.answer_rule_type && OPEN_QUESTION_HINTS[newQ.answer_rule_type]) && (
                  <p className="text-xs text-slate-500 mt-1">{OPEN_QUESTION_HINTS[newQ.answer_rule_type]}</p>
                )}
              </div>
            </>
          )}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => editingQuestion && updateQuestionMutation.mutate(editingQuestion.id)}
              disabled={!newQ.text.trim() || updateQuestionMutation.isPending}
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => { setShowEditQuestion(false); setEditingQuestion(null); }} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCreateQuestion} onClose={() => setShowCreateQuestion(false)} title="Yeni sual" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Sual mətni *</label>
            <textarea
              className="input w-full h-24"
              value={newQ.text}
              onChange={(e) => setNewQ((q) => ({ ...q, text: e.target.value }))}
              placeholder="Sualı yazın..."
            />
          </div>
          <div>
            <label className="label">Tip</label>
            <select
              className="input w-full"
              value={newQ.type}
              onChange={(e) => setNewQ((q) => ({ ...q, type: e.target.value }))}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {newQ.type === "MULTIPLE_CHOICE" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">Variantlar (düzgün olanı işarələyin)</label>
                <button type="button" onClick={addOption} className="text-sm text-blue-600">
                  + Variant
                </button>
              </div>
              {newQ.options.map((opt, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="radio"
                    name="correct"
                    checked={opt.is_correct}
                    onChange={() => setOption(i, opt.text, true)}
                  />
                  <input
                    className="input flex-1"
                    value={opt.text}
                    onChange={(e) => setOption(i, e.target.value, opt.is_correct)}
                    placeholder={`Variant ${i + 1}`}
                  />
                  <button type="button" onClick={() => removeOption(i)} className="text-red-600">Sil</button>
                </div>
              ))}
            </div>
          )}
          {(newQ.type === "OPEN_SINGLE_VALUE" || newQ.type.startsWith("OPEN_")) && (
            <>
              <div>
                <label className="label">Açıq sual tipi</label>
                <select
                  className="input w-full"
                  value={newQ.answer_rule_type || (newQ.type === "OPEN_ORDERED" ? "ORDERED_DIGITS" : newQ.type === "OPEN_UNORDERED" ? "UNORDERED_DIGITS" : "NUMERIC_EQUAL")}
                  onChange={(e) => setNewQ((q) => ({ ...q, answer_rule_type: e.target.value }))}
                >
                  <option value="">Seçin</option>
                  <option value="ORDERED_DIGITS">Ardıcıllıq vacibdir (135)</option>
                  <option value="UNORDERED_DIGITS">Ardıcıllıq vacib deyil (1,3,5)</option>
                  <option value="NUMERIC_EQUAL">Rəqəm nəticə (15)</option>
                  {ANSWER_RULES.filter((r) => !["ORDERED_DIGITS", "UNORDERED_DIGITS", "NUMERIC_EQUAL"].includes(r.value)).map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Düzgün cavab</label>
                <input
                  className="input w-full"
                  value={newQ.correct_answer}
                  onChange={(e) => setNewQ((q) => ({ ...q, correct_answer: e.target.value }))}
                  placeholder={OPEN_QUESTION_HINTS[newQ.answer_rule_type || ""] || "Düzgün cavab"}
                />
                {(newQ.answer_rule_type && OPEN_QUESTION_HINTS[newQ.answer_rule_type]) && (
                  <p className="text-xs text-slate-500 mt-1">{OPEN_QUESTION_HINTS[newQ.answer_rule_type]}</p>
                )}
              </div>
            </>
          )}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => createQuestionMutation.mutate()}
              disabled={!newQ.text.trim() || createQuestionMutation.isPending}
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateQuestion(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      {/* PDF Library Section */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">PDF Kitabxanası</h2>
          <button onClick={() => setShowUploadPDF(true)} className="btn-primary">
            <Upload className="w-4 h-4" />
            PDF yüklə
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              className="input pl-8 w-full text-sm"
              placeholder="PDF axtar..."
              value={pdfSearch}
              onChange={(e) => setPdfSearch(e.target.value)}
            />
          </div>
          <input
            type="number"
            className="input text-sm w-32"
            placeholder="İl"
            value={pdfYearFilter}
            onChange={(e) => setPdfYearFilter(e.target.value)}
          />
        </div>
        {pdfsLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : pdfs.length === 0 ? (
          <p className="text-slate-500 py-4">PDF tapılmadı</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pdfs.map((pdf) => (
              <div key={pdf.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-slate-600" />
                    <h3 className="font-medium text-slate-900 line-clamp-1">{pdf.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => confirm("Bu PDF-i silmək istədiyinizə əminsiniz?") && deletePDFMutation.mutate(pdf.id)}
                    className="text-red-600 hover:bg-red-50 p-1 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-2">{pdf.original_filename}</p>
                {pdf.file_size_mb && (
                  <p className="text-xs text-slate-500 mb-2">{pdf.file_size_mb} MB</p>
                )}
                {pdf.year && (
                  <p className="text-xs text-slate-500 mb-2">İl: {pdf.year}</p>
                )}
                {pdf.file_url && (
                  <a
                    href={pdf.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Bax
                  </a>
                )}
                {pdf.file && !pdf.file_url && (
                  <a
                    href={
                      pdf.file.startsWith("http")
                        ? pdf.file
                        : `${API_BASE_URL.replace(/\/api\/?$/, "")}/media/${pdf.file}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Bax
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload PDF Modal */}
      <Modal isOpen={showUploadPDF} onClose={() => { setShowUploadPDF(false); setUploadFile(null); setNewPDF({ title: "", year: "", tags: "", source: "" }); }} title="PDF yüklə">
        <div className="space-y-4">
          <div>
            <label className="label">PDF faylı *</label>
            <input
              type="file"
              accept=".pdf"
              className="input"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
            {uploadFile && <p className="text-sm text-slate-600 mt-1">{uploadFile.name}</p>}
          </div>
          <div>
            <label className="label">Başlıq</label>
            <input
              className="input w-full"
              value={newPDF.title}
              onChange={(e) => setNewPDF((p) => ({ ...p, title: e.target.value }))}
              placeholder="PDF başlığı (boş qoysanız fayl adı istifadə olunacaq)"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">İl</label>
              <input
                type="number"
                className="input w-full"
                value={newPDF.year}
                onChange={(e) => setNewPDF((p) => ({ ...p, year: e.target.value }))}
                placeholder="2024"
              />
            </div>
            <div>
              <label className="label">Mənbə</label>
              <input
                className="input w-full"
                value={newPDF.source}
                onChange={(e) => setNewPDF((p) => ({ ...p, source: e.target.value }))}
                placeholder="Mənbə"
              />
            </div>
          </div>
          <div>
            <label className="label">Teqlər (vergüllə ayrılmış)</label>
            <input
              className="input w-full"
              value={newPDF.tags}
              onChange={(e) => setNewPDF((p) => ({ ...p, tags: e.target.value }))}
              placeholder="riyaziyyat, test, 2024"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => uploadPDFMutation.mutate()}
              disabled={!uploadFile || uploadPDFMutation.isPending}
              className="btn-primary flex-1"
            >
              Yüklə
            </button>
            <button
              type="button"
              onClick={() => { setShowUploadPDF(false); setUploadFile(null); setNewPDF({ title: "", year: "", tags: "", source: "" }); }}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}