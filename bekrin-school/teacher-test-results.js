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

let currentTeacher = null;
let activeTests = [];
let currentTest = null;
let currentResults = [];

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

    // Müəllim yoxlaması
    const userDoc = await db.collection("users").doc(user.email).get();

    if (!userDoc.exists || userDoc.data().role !== "teacher") {
      alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
      window.location.href = "index.html";
      return;
    }

    currentTeacher = { email: user.email, ...userDoc.data() };
    console.log("Müəllim təsdiqləndi:", currentTeacher.fullName);

    // Testləri yüklə
    await loadActiveTests();

    // Event listeners
    setupEventListeners();

    // Loading gizlət
    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("mainContent").style.display = "block";
  });
});

// Event listeners
function setupEventListeners() {
  document
    .getElementById("testFilter")
    .addEventListener("change", onTestSelect);
  document
    .getElementById("groupFilter")
    .addEventListener("change", onGroupFilter);
}

// Aktiv testləri yüklə
async function loadActiveTests() {
  try {
    console.log("Testlər yüklənir...");

    const testsSnapshot = await db
      .collection("activeTests")
      .where("assignedBy", "==", currentTeacher.email)
      .orderBy("assignedAt", "desc")
      .get();

    activeTests = [];
    testsSnapshot.forEach((doc) => {
      activeTests.push({ id: doc.id, ...doc.data() });
    });

    console.log("Test sayı:", activeTests.length);

    // Test filtrini doldur
    const testFilter = document.getElementById("testFilter");
    testFilter.innerHTML = '<option value="">Test seçin...</option>';

    activeTests.forEach((test) => {
      testFilter.innerHTML += `
                <option value="${test.id}">
                    ${test.testName} - ${test.groupName} (${
        test.submissions || 0
      }/${test.totalStudents || 0})
                </option>
            `;
    });
  } catch (error) {
    console.error("Testlər yüklənərkən xəta:", error);
    alert("Xəta: " + error.message);
  }
}

// Test seçildi
async function onTestSelect() {
  const testId = document.getElementById("testFilter").value;

  if (!testId) {
    document.getElementById("selectTestState").style.display = "block";
    document.getElementById("resultsContent").style.display = "none";
    document.getElementById("exportBtn").style.display = "none";
    return;
  }

  currentTest = activeTests.find((t) => t.id === testId);

  if (!currentTest) {
    alert("Test tapılmadı!");
    return;
  }

  console.log("Test seçildi:", currentTest.testName);

  // Nəticələri yüklə
  await loadResults();
}

// Nəticələri yüklə
async function loadResults() {
  try {
    console.log("Nəticələr yüklənir...");

    // Test məlumatlarını göstər
    displayTestInfo();

    // Nəticələri al
    const resultsSnapshot = await db
      .collection("studentTests")
      .where("activeTestId", "==", currentTest.id)
      .where("status", "==", "graded")
      .get();

    currentResults = [];
    resultsSnapshot.forEach((doc) => {
      currentResults.push({ id: doc.id, ...doc.data() });
    });

    console.log("Nəticə sayı:", currentResults.length);

    // Qrup filtrini doldur
    populateGroupFilter();

    // Statistika hesabla və göstər
    calculateAndDisplayStats();

    // Cədvəli doldur
    displayResultsTable();

    // Məzmunu göstər
    document.getElementById("selectTestState").style.display = "none";
    document.getElementById("resultsContent").style.display = "block";
    document.getElementById("exportBtn").style.display = "inline-block";
  } catch (error) {
    console.error("Nəticələr yüklənərkən xəta:", error);
    alert("Xəta: " + error.message);
  }
}

// Test məlumatlarını göstər
function displayTestInfo() {
  document.getElementById("testName").textContent = currentTest.testName;

  const testTypeBadge = document.getElementById("testType");
  testTypeBadge.textContent =
    currentTest.testType === "quiz" ? "Quiz" : "Sınaq";
  testTypeBadge.className =
    currentTest.testType === "quiz"
      ? "test-badge badge-quiz"
      : "test-badge badge-sinaq";

  document.getElementById("groupName").textContent = currentTest.groupName;
  document.getElementById("totalSubmissions").textContent =
    currentTest.submissions || 0;

  const startDate = currentTest.startDate?.toDate();
  document.getElementById("testDate").textContent = startDate
    ? startDate.toLocaleDateString("az-AZ")
    : "--";
}

// Qrup filtrini doldur
function populateGroupFilter() {
  const groupFilter = document.getElementById("groupFilter");
  groupFilter.innerHTML = '<option value="">Bütün qruplar</option>';

  // Bu testdə yalnız 1 qrup olduğu üçün, sadə saxlayırıq
  // Gələcəkdə çox qruplu testlər üçün genişləndirə bilərsiniz
}

// Qrup filtri
function onGroupFilter() {
  // Əgər qrup filtri lazımdırsa, burada yenidən filter edə bilərsiniz
  displayResultsTable();
}

// Statistika hesabla və göstər
function calculateAndDisplayStats() {
  if (currentResults.length === 0) {
    document.getElementById("averageScore").textContent = "0";
    document.getElementById("highestScore").textContent = "0";
    document.getElementById("lowestScore").textContent = "0";
    document.getElementById("successRate").textContent = "0%";
    return;
  }

  const scores = currentResults.map((r) => r.finalScore || 0);

  // Orta bal
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  document.getElementById("averageScore").textContent = Math.round(average);

  // Ən yüksək
  const highest = Math.max(...scores);
  document.getElementById("highestScore").textContent = highest;

  // Ən aşağı
  const lowest = Math.min(...scores);
  document.getElementById("lowestScore").textContent = lowest;

  // Uğur faizi (70 və yuxarı)
  const successCount = scores.filter((s) => s >= 70).length;
  const successRate = Math.round((successCount / scores.length) * 100);
  document.getElementById("successRate").textContent = successRate + "%";
}

// Cədvəli doldur
function displayResultsTable() {
  const tbody = document.getElementById("resultsTableBody");
  tbody.innerHTML = "";

  if (currentResults.length === 0) {
    tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: #999;">
                    📭 Heç bir şagird testi tamamlamayıb və ya qiymətləndirilməyib
                </td>
            </tr>
        `;
    return;
  }

  // Rank-a görə sırala (kiçikdən böyüyə)
  const sortedResults = [...currentResults].sort((a, b) => {
    return (a.rank || 999) - (b.rank || 999);
  });

  sortedResults.forEach((result, index) => {
    const submittedDate = result.submittedAt?.toDate();
    const dateStr = submittedDate
      ? submittedDate.toLocaleDateString("az-AZ")
      : "--";

    const rank = result.rank || "--";
    const totalStudents = result.totalStudents || currentResults.length;

    // Rank badge
    let rankClass = "rank-other";
    if (rank === 1) rankClass = "rank-1";
    else if (rank === 2) rankClass = "rank-2";
    else if (rank === 3) rankClass = "rank-3";

    // Faiz rəngi
    const percentage = result.percentage || 0;
    let percentageClass = "percentage-low";
    if (percentage >= 85) percentageClass = "percentage-high";
    else if (percentage >= 70) percentageClass = "percentage-medium";

    // Avtomatik skor
    const autoScore = result.autoScore || {};
    const closedCorrect = autoScore.closedCorrect || 0;
    const openCorrect = autoScore.openCorrect || 0;

    // Yazı balı
    const writingScores = result.writingScores || [];
    const writingTotal = writingScores
      .reduce((sum, s) => sum + s, 0)
      .toFixed(2);

    tbody.innerHTML += `
            <tr>
                <td>${index + 1}</td>
                <td>${result.studentEmail || "--"}</td>
                <td class="score-cell">${Math.round(
                  result.finalScore || 0
                )}</td>
                <td class="percentage-cell ${percentageClass}">${percentage}%</td>
                <td><span class="rank-badge ${rankClass}">${rank}/${totalStudents}</span></td>
                <td>${closedCorrect}</td>
                <td>${openCorrect}</td>
                <td>${writingTotal}</td>
                <td>${dateStr}</td>
                <td>✅ Qiymətləndirilib</td>
            </tr>
        `;
  });
}

// Excel export
function exportToExcel() {
  if (!currentTest || currentResults.length === 0) {
    alert("Export üçün nəticə yoxdur!");
    return;
  }

  // CSV formatında yarat
  let csv =
    "No,Şagird,Bal,Faiz,Rank,Qapalı Suallar,Açıq Suallar,Yazı İşləri,Göndərilmə Tarixi\n";

  const sortedResults = [...currentResults].sort(
    (a, b) => (a.rank || 999) - (b.rank || 999)
  );

  sortedResults.forEach((result, index) => {
    const submittedDate = result.submittedAt?.toDate();
    const dateStr = submittedDate
      ? submittedDate.toLocaleDateString("az-AZ")
      : "--";

    const autoScore = result.autoScore || {};
    const closedCorrect = autoScore.closedCorrect || 0;
    const openCorrect = autoScore.openCorrect || 0;
    const writingScores = result.writingScores || [];
    const writingTotal = writingScores
      .reduce((sum, s) => sum + s, 0)
      .toFixed(2);

    csv += `${index + 1},${result.studentEmail},${Math.round(
      result.finalScore || 0
    )},${result.percentage || 0}%,${result.rank || "--"}/${
      result.totalStudents || currentResults.length
    },${closedCorrect},${openCorrect},${writingTotal},${dateStr}\n`;
  });

  // CSV faylını yüklə
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `${currentTest.testName}_neticeler_${
      new Date().toISOString().split("T")[0]
    }.csv`
  );
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log("✅ Excel export tamamlandı");
}
