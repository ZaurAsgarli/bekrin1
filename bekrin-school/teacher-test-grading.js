// ============================================
// FİREBASE KONFİQURASİYASI
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

// Firebase başlat
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// ============================================
// QLOBAL VƏZİYYƏT
// ============================================

let currentTeacher = null;
let pendingTests = [];
let currentSubmission = null;
let currentTemplate = null;
let writingScores = [];

// ============================================
// DOM ELEMENT REFERENSLƏRİ
// ============================================

const testFilter = document.getElementById("testFilter");
const groupFilter = document.getElementById("groupFilter");
const pendingTestsContainer = document.getElementById("pendingTestsContainer");
const gradingModal = document.getElementById("gradingModal");
const closeGradingBtn = document.getElementById("closeGradingBtn");
const testTitle = document.getElementById("testTitle");
const autoScoreDisplay = document.getElementById("autoScoreDisplay");
const writingQuestionsContainer = document.getElementById(
  "writingQuestionsContainer"
);
const finalScoreDisplay = document.getElementById("finalScoreDisplay");
const confirmGradingBtn = document.getElementById("confirmGradingBtn");

// ============================================
// İSTİFADƏÇİ DOĞRULAMA
// ============================================

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // Müəllim yoxlaması
  const userDoc = await db.collection("users").doc(user.email).get();
  if (!userDoc.exists || userDoc.data().role !== "teacher") {
    alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
    auth.signOut();
    window.location.href = "index.html";
    return;
  }

  currentTeacher = user.email;
  console.log("✅ Müəllim:", currentTeacher);

  loadPendingTests();
  setupEventListeners();
});

// ============================================
// PENDİNG TESTLƏRİ YÜKLƏ
// ============================================

async function loadPendingTests() {
  try {
    console.log("📋 Pending testlər yüklənir...");

    const snapshot = await db
      .collection("studentTests")
      .where("status", "==", "pending")
      .orderBy("submittedAt", "desc")
      .get();

    pendingTests = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Template məlumatını yüklə
      const templateDoc = await db
        .collection("testTemplates")
        .doc(data.templateId)
        .get();
      const templateData = templateDoc.exists ? templateDoc.data() : null;

      pendingTests.push({
        id: doc.id,
        ...data,
        template: templateData,
      });
    }

    console.log("✅ Yüklənən testlər:", pendingTests.length);

    populateFilters();
    displayPendingTests();
  } catch (error) {
    console.error("❌ Testlər yüklənərkən xəta:", error);
  }
}

// ============================================
// FİLTRLƏRİ DOLDUR
// ============================================

function populateFilters() {
  // Test adlarını topla
  const testNames = [...new Set(pendingTests.map((t) => t.testName))];
  testFilter.innerHTML = '<option value="">Bütün testlər</option>';
  testNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    testFilter.appendChild(option);
  });

  // Qrup adlarını topla
  const groupNames = [...new Set(pendingTests.map((t) => t.groupName))];
  groupFilter.innerHTML = '<option value="">Bütün qruplar</option>';
  groupNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    groupFilter.appendChild(option);
  });
}

// ============================================
// PENDİNG TESTLƏRİ GÖSTƏR
// ============================================

function displayPendingTests() {
  const selectedTest = testFilter.value;
  const selectedGroup = groupFilter.value;

  let filteredTests = pendingTests;

  if (selectedTest) {
    filteredTests = filteredTests.filter((t) => t.testName === selectedTest);
  }

  if (selectedGroup) {
    filteredTests = filteredTests.filter((t) => t.groupName === selectedGroup);
  }

  if (filteredTests.length === 0) {
    pendingTestsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-check"></i>
                <p>Qiymətləndirilməyi gözləyən test yoxdur</p>
            </div>
        `;
    return;
  }

  pendingTestsContainer.innerHTML = filteredTests
    .map(
      (test) => `
        <div class="test-card">
            <div class="test-header">
                <h3>${test.testName}</h3>
                <span class="test-type">${test.testType || "Quiz"}</span>
            </div>
            <div class="test-info">
                <div class="info-row">
                    <i class="fas fa-user"></i>
                    <span>${test.studentEmail}</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-users"></i>
                    <span>${test.groupName}</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-clock"></i>
                    <span>${formatTimestamp(test.submittedAt)}</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-robot"></i>
                    <span>Avtomatik bal: ${test.autoScore || 0} / ${
        test.maxScore || 100
      }</span>
                </div>
            </div>
            <button class="grade-btn" onclick="openGradingModal('${test.id}')">
                <i class="fas fa-edit"></i> Qiymətləndir
            </button>
        </div>
    `
    )
    .join("");
}

// ============================================
// QİYMƏTLƏNDİRMƏ MODALI AÇ
// ============================================

async function openGradingModal(testId) {
  const test = pendingTests.find((t) => t.id === testId);
  if (!test) return;

  currentSubmission = test;
  currentTemplate = test.template;

  if (!currentTemplate) {
    alert("Test şablonu tapılmadı!");
    return;
  }

  // Modal məlumatlarını doldur
  testTitle.textContent = `${test.testName} - ${test.studentEmail}`;

  const closedScore = test.closedScore || 0;
  const openScore = test.openScore || 0;
  const writingCount = currentTemplate.structure?.writing || 0;

  autoScoreDisplay.textContent = `Bağlı suallar: ${closedScore} bal | Açıq suallar: ${openScore} bal | Yazı işləri: ${writingCount} sual`;

  // Yazı işlərini göstər
  displayWritingQuestions(test, writingCount);

  // Modalı göstər
  gradingModal.classList.add("active");
}

// ============================================
// YAZI İŞLƏRİNİ GÖSTƏR
// ============================================

function displayWritingQuestions(test, writingCount) {
  if (writingCount === 0) {
    writingQuestionsContainer.innerHTML = "<p>Bu testdə yazı işi yoxdur.</p>";
    updateFinalScore();
    return;
  }

  // WritingScores massivini hazırla
  writingScores = new Array(writingCount).fill(0);

  writingQuestionsContainer.innerHTML = "";

  for (let i = 0; i < writingCount; i++) {
    const answerImage = test.writingAnswers?.[i] || null;

    const questionDiv = document.createElement("div");
    questionDiv.className = "writing-question";
    questionDiv.innerHTML = `
            <h4>Yazı işi ${i + 1}</h4>
            ${
              answerImage
                ? `
                <div class="answer-image">
                    <img src="${answerImage}" alt="Cavab ${
                    i + 1
                  }" onclick="window.open('${answerImage}', '_blank')">
                </div>
            `
                : '<p class="no-answer">Cavab yüklənməyib</p>'
            }
            
            <div class="score-selector">
                <label>Qiymət seç:</label>
                <div class="score-options">
                    <button class="score-btn" data-index="${i}" data-score="0">0</button>
                    <button class="score-btn" data-index="${i}" data-score="0.33">0.33</button>
                    <button class="score-btn" data-index="${i}" data-score="0.5">0.5</button>
                    <button class="score-btn" data-index="${i}" data-score="0.67">0.67</button>
                    <button class="score-btn active" data-index="${i}" data-score="1">1</button>
                </div>
            </div>
        `;

    writingQuestionsContainer.appendChild(questionDiv);
  }

  // Skor seçimi event listener
  document.querySelectorAll(".score-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const index = parseInt(this.dataset.index);
      const score = parseFloat(this.dataset.score);

      // Aktiv class-ı dəyişdir
      this.parentElement
        .querySelectorAll(".score-btn")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      // Skoru yenilə
      writingScores[index] = score;
      updateFinalScore();
    });
  });

  // Default: hamısı 1 bal
  writingScores.fill(1);
  updateFinalScore();
}

// ============================================
// FİNAL SKORU YENİLƏ
// ============================================

function updateFinalScore() {
  const closedScore = currentSubmission.closedScore || 0;
  const openScore = currentSubmission.openScore || 0;

  // Yazı işləri balı
  const writingTotal = writingScores.reduce((sum, score) => sum + score, 0);
  const writingCount = currentTemplate.structure?.writing || 0;
  const writingPercentage =
    writingCount > 0 ? (writingTotal / writingCount) * 100 : 0;

  // Yazı işləri çəkisi 30 bal
  const writingWeight = 30;
  const writingScore = (writingPercentage / 100) * writingWeight;

  // Final skor
  const finalScore = Math.round(closedScore + openScore + writingScore);

  finalScoreDisplay.textContent = `Final Bal: ${finalScore} / 100`;
}

// ============================================
// QİYMƏTLƏNDİRMƏNİ TƏSDİQLƏ
// ============================================

async function confirmGrading() {
  try {
    // Bütün yazı işlərinin qiymətləndirildiyini yoxla
    const writingCount = currentTemplate.structure?.writing || 0;

    if (writingCount > 0 && writingScores.length !== writingCount) {
      alert("Bütün yazı işlərini qiymətləndirin!");
      return;
    }

    console.log("💾 Qiymətləndirmə saxlanılır...");

    const closedScore = currentSubmission.closedScore || 0;
    const openScore = currentSubmission.openScore || 0;

    const writingTotal = writingScores.reduce((sum, score) => sum + score, 0);
    const writingPercentage =
      writingCount > 0 ? (writingTotal / writingCount) * 100 : 0;
    const writingScore = (writingPercentage / 100) * 30;

    const finalScore = Math.round(closedScore + openScore + writingScore);
    const percentage = Math.round((finalScore / 100) * 100);

    // Rank hesabla
    const { rank, totalStudents } = await calculateRank(
      currentSubmission.activeTestId,
      finalScore
    );

    // Firestore yenilə
    await db.collection("studentTests").doc(currentSubmission.id).update({
      writingScores: writingScores,
      finalScore: finalScore,
      percentage: percentage,
      rank: rank,
      totalStudents: totalStudents,
      status: "graded",
      gradedAt: firebase.firestore.FieldValue.serverTimestamp(),
      gradedBy: currentTeacher,
    });

    // ✅ BİLDİRİŞ GÖNDƏR
    await sendTestResultNotification(
      currentSubmission.studentEmail,
      currentSubmission.studentEmail.split("@")[0],
      currentSubmission.testName,
      finalScore
    );

    console.log("✅ Qiymətləndirmə tamamlandı və bildiriş göndərildi!");
    alert(
      "✅ Qiymətləndirmə uğurla saxlanıldı və şagirdə bildiriş göndərildi!"
    );

    closeGradingModal();
    loadPendingTests();
  } catch (error) {
    console.error("❌ Qiymətləndirmə saxlanarkən xəta:", error);
    alert("Xəta baş verdi: " + error.message);
  }
}

// ============================================
// RANK HESABLA
// ============================================

async function calculateRank(activeTestId, studentScore) {
  try {
    // Bu test üçün bütün graded nəticələri al
    const snapshot = await db
      .collection("studentTests")
      .where("activeTestId", "==", activeTestId)
      .where("status", "==", "graded")
      .get();

    const scores = snapshot.docs.map((doc) => doc.data().finalScore || 0);
    scores.push(studentScore); // Cari şagirdin skorunu əlavə et

    // Yüksəkdən aşağıya sırala
    scores.sort((a, b) => b - a);

    const rank = scores.indexOf(studentScore) + 1;
    const totalStudents = scores.length;

    return { rank, totalStudents };
  } catch (error) {
    console.error("❌ Rank hesablanarkən xəta:", error);
    return { rank: 0, totalStudents: 0 };
  }
}

// ============================================
// MODALI BAĞLA
// ============================================

function closeGradingModal() {
  gradingModal.classList.remove("active");
  currentSubmission = null;
  currentTemplate = null;
  writingScores = [];
}

// ============================================
// EVENT LİSTENERLƏR
// ============================================

function setupEventListeners() {
  testFilter.addEventListener("change", displayPendingTests);
  groupFilter.addEventListener("change", displayPendingTests);
  closeGradingBtn.addEventListener("click", closeGradingModal);
  confirmGradingBtn.addEventListener("click", confirmGrading);

  // Modal kənarına klik
  gradingModal.addEventListener("click", (e) => {
    if (e.target === gradingModal) {
      closeGradingModal();
    }
  });
}

// ============================================
// YARDIMÇI FUNKSİYALAR
// ============================================

function formatTimestamp(timestamp) {
  if (!timestamp) return "Bilinmir";

  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000); // saniyə

  if (diff < 60) return "İndicə";
  if (diff < 3600) return `${Math.floor(diff / 60)} dəq əvvəl`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat əvvəl`;
  return `${Math.floor(diff / 86400)} gün əvvəl`;
}

// ============================================
// BİLDİRİŞ SİSTEMİ
// ============================================

/**
 * Test nəticəsi bildirişi göndər
 * @param {string} studentEmail - Şagird emaili
 * @param {string} studentName - Şagird adı
 * @param {string} testName - Test adı
 * @param {number} score - Qazanılan bal
 */
async function sendTestResultNotification(
  studentEmail,
  studentName,
  testName,
  score
) {
  try {
    console.log(
      "📝 Test nəticəsi bildirişi göndərilir:",
      studentName,
      testName,
      score
    );

    const message = `"${testName}" testində ${score} bal qazandınız.`;

    // 1) Şagirdə bildiriş
    await db.collection("notifications").add({
      recipientEmail: studentEmail,
      studentEmail: studentEmail,
      studentName: studentName,
      type: "test_result",
      message: message,
      testName: testName,
      score: score,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // 2) Valideynə bildiriş (əgər varsa)
    const studentDoc = await db.collection("students").doc(studentEmail).get();
    if (studentDoc.exists && studentDoc.data().parentEmail) {
      const parentEmail = studentDoc.data().parentEmail;

      await db.collection("notifications").add({
        recipientEmail: parentEmail,
        studentEmail: studentEmail,
        studentName: studentName,
        type: "test_result",
        message: message,
        testName: testName,
        score: score,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    console.log("✅ Test nəticəsi bildirişi göndərildi!");
  } catch (error) {
    console.error("❌ Test bildirişi göndərilən xəta:", error);
    // Bildiriş xətası əsas əməliyyatı dayandırmasın
  }
}

// ============================================
// QLOBAL FUNKSİYALAR (HTML-dən çağırılır)
// ============================================

window.openGradingModal = openGradingModal;
