// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753"
};



// Firebase başlat
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let submissionId = null;
let submission = null;
let testTemplate = null;

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Nəticələr səhifəsi yüklənir...");

  // İstifadəçi yoxlaması
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      alert("Giriş etməlisiniz!");
      window.location.href = "index.html";
      return;
    }

    console.log("İstifadəçi:", user.email);

    // submissionId URL-dən al
    const urlParams = new URLSearchParams(window.location.search);
    submissionId = urlParams.get("submissionId");

    if (!submissionId) {
      alert("Nəticə tapılmadı!");
      window.location.href = "student-dashboard.html";
      return;
    }

    console.log("Submission ID:", submissionId);

    // Nəticələri yüklə
    await loadResults();
  });
});

// Nəticələri yüklə
async function loadResults() {
  try {
    console.log("Nəticələr yüklənir...");

    // Submission məlumatını al
    const submissionDoc = await db
      .collection("studentTests")
      .doc(submissionId)
      .get();

    if (!submissionDoc.exists) {
      throw new Error("Nəticə tapılmadı");
    }

    submission = { id: submissionDoc.id, ...submissionDoc.data() };
    console.log("Submission:", submission);

    // Test template-ini al
    const templateDoc = await db
      .collection("testTemplates")
      .doc(submission.templateId)
      .get();

    if (!templateDoc.exists) {
      throw new Error("Test şablonu tapılmadı");
    }

    testTemplate = { id: templateDoc.id, ...templateDoc.data() };
    console.log("Test Template:", testTemplate);

    // Nəticələri göstər
    displayResults();
  } catch (error) {
    console.error("Nəticələr yüklənərkən xəta:", error);
    alert("Xəta: " + error.message);
    document.getElementById("loadingScreen").innerHTML =
      '<h2 style="color: #f44336;">⚠️ Nəticələr yüklənə bilmədi</h2>' +
      '<p style="color: white; margin-top: 10px;">' +
      error.message +
      "</p>" +
      '<a href="student-dashboard.html" class="btn btn-primary" style="margin-top: 20px;">Ana Səhifəyə Qayıt</a>';
  }
}

// Nəticələri göstər
function displayResults() {
  console.log("Nəticələr göstərilir...");

  // Loading gizlət, results göstər
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("resultsContainer").style.display = "block";

  // Başlıq məlumatları
  document.getElementById("testName").textContent = submission.testName;

  const testTypeBadge = document.getElementById("testTypeBadge");
  testTypeBadge.textContent = submission.testType === "quiz" ? "Quiz" : "Sınaq";
  testTypeBadge.className =
    submission.testType === "quiz" ? "badge badge-quiz" : "badge badge-sinaq";

  const submittedDate = submission.submittedAt?.toDate();
  document.getElementById("submittedDate").textContent =
    "📅 Göndərilmə: " +
    (submittedDate ? submittedDate.toLocaleDateString("az-AZ") : "--");

  // Nəticə kartları
  document.getElementById("scoreValue").textContent = Math.round(
    submission.finalScore || 0
  );
  document.getElementById("maxScore").textContent =
    "/ " + (submission.maxScore || 100);
  document.getElementById("percentageValue").textContent =
    Math.round(submission.percentage || 0) + "%";
  document.getElementById("rankValue").textContent = submission.rank || "--";
  document.getElementById("totalStudents").textContent =
    "/ " + (submission.totalStudents || "--");

  // Təfərrüatlı nəticələr
  displayScoreBreakdown();

  // Cavab təhlili
  displayAnswersAnalysis();
}

// Təfərrüatlı nəticələr
function displayScoreBreakdown() {
  const breakdown = document.getElementById("scoreBreakdown");
  breakdown.innerHTML = "";

  const structure = testTemplate.questionStructure;
  const autoScore = submission.autoScore || {};
  const writingScores = submission.writingScores || [];

  // Qapalı suallar
  const closedCorrect = autoScore.closedCorrect || 0;
  const closedTotal = structure.closed;
  const closedPercentage =
    closedTotal > 0 ? Math.round((closedCorrect / closedTotal) * 100) : 0;

  breakdown.innerHTML += `
        <div class="score-item">
            <span class="label">📝 Qapalı Suallar</span>
            <div>
                <span class="score">${closedCorrect}/${closedTotal}</span>
                <span class="percentage">(${closedPercentage}%)</span>
            </div>
        </div>
    `;

  // Açıq suallar
  const openCorrect = autoScore.openCorrect || 0;
  const openTotal = structure.open;
  const openPercentage =
    openTotal > 0 ? Math.round((openCorrect / openTotal) * 100) : 0;

  breakdown.innerHTML += `
        <div class="score-item">
            <span class="label">✏️ Açıq Suallar</span>
            <div>
                <span class="score">${openCorrect}/${openTotal}</span>
                <span class="percentage">(${openPercentage}%)</span>
            </div>
        </div>
    `;

  // Yazı işləri
  const writingTotal = structure.writing;
  const writingSum = writingScores.reduce((sum, score) => sum + score, 0);
  const writingPercentage =
    writingTotal > 0 ? Math.round((writingSum / writingTotal) * 100) : 0;

  breakdown.innerHTML += `
        <div class="score-item">
            <span class="label">📄 Yazı İşləri</span>
            <div>
                <span class="score">${writingSum.toFixed(
                  2
                )}/${writingTotal}</span>
                <span class="percentage">(${writingPercentage}%)</span>
            </div>
        </div>
    `;
}

// Cavab təhlili
function displayAnswersAnalysis() {
  const grid = document.getElementById("answersGrid");
  grid.innerHTML = "";

  const structure = testTemplate.questionStructure;
  const answerKey = testTemplate.answerKey;
  const studentAnswers = submission.answers;

  // Qapalı suallar
  for (let i = 0; i < structure.closed; i++) {
    const qNum = i + 1;
    const correctAnswer = answerKey.closed[i];
    const studentAnswer = studentAnswers.closed[i] || "-";
    const isCorrect = correctAnswer === studentAnswer;

    grid.innerHTML += `
            <div class="answer-item ${isCorrect ? "correct" : "incorrect"}">
                <span class="question-number">Sual ${qNum}</span>
                <div class="answer-content">
                    <div class="your-answer">
                        <span>Seçiminiz:</span>
                        <span class="value">${studentAnswer}</span>
                    </div>
                    <div class="correct-answer">
                        <span>Düzgün cavab:</span>
                        <span class="value">${correctAnswer}</span>
                    </div>
                </div>
                <span class="status-icon">${isCorrect ? "✅" : "❌"}</span>
            </div>
        `;
  }

  // Açıq suallar
  for (let i = 0; i < structure.open; i++) {
    const qNum = structure.closed + i + 1;
    const correctAnswer = answerKey.open[i];
    const studentAnswer = studentAnswers.open[i] || "-";
    const isCorrect = String(correctAnswer) === String(studentAnswer);

    grid.innerHTML += `
            <div class="answer-item ${isCorrect ? "correct" : "incorrect"}">
                <span class="question-number">Sual ${qNum}</span>
                <div class="answer-content">
                    <div class="your-answer">
                        <span>Cavabınız:</span>
                        <span class="value">${studentAnswer}</span>
                    </div>
                    <div class="correct-answer">
                        <span>Düzgün cavab:</span>
                        <span class="value">${correctAnswer}</span>
                    </div>
                </div>
                <span class="status-icon">${isCorrect ? "✅" : "❌"}</span>
            </div>
        `;
  }

  // Yazı işləri
  const writingScores = submission.writingScores || [];
  for (let i = 0; i < structure.writing; i++) {
    const qNum = structure.closed + structure.open + i + 1;
    const score = writingScores[i] || 0;
    const maxScore = 1;
    const percentage = Math.round((score / maxScore) * 100);

    let statusClass = "partial";
    let statusIcon = "⚠️";

    if (score === 1) {
      statusClass = "correct";
      statusIcon = "✅";
    } else if (score === 0) {
      statusClass = "incorrect";
      statusIcon = "❌";
    }

    grid.innerHTML += `
            <div class="answer-item ${statusClass}">
                <span class="question-number">Sual ${qNum}</span>
                <div class="answer-content">
                    <div class="your-answer">
                        <span>Yazı işi:</span>
                        <span class="value">Müəllim tərəfindən qiymətləndirilib</span>
                    </div>
                    <div class="correct-answer">
                        <span>Aldığınız bal:</span>
                        <span class="value">${score} / ${maxScore} (${percentage}%)</span>
                    </div>
                </div>
                <span class="status-icon">${statusIcon}</span>
            </div>
        `;
  }
}
