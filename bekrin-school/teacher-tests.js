// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753"
};



// Firebase başlatma
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Global dəyişənlər
let currentTab = "library";
let testTemplates = [];
let activeTests = [];
let completedTests = [];

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", function () {
  console.log("Testlər səhifəsi yüklənir...");

  // Auth yoxlama
  auth.onAuthStateChanged((user) => {
    if (!user) {
      console.log("İstifadəçi daxil olmayıb");
      window.location.href = "index.html";
      return;
    }

    console.log("İstifadəçi:", user.email);

    // Müəllim rolunu yoxla
    db.collection("users")
      .doc(user.email)
      .get()
      .then((doc) => {
        if (!doc.exists || doc.data().role !== "teacher") {
          alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
          window.location.href = "index.html";
          return;
        }

        console.log("Müəllim təsdiqləndi:", doc.data());

        // Məlumatları yüklə
        loadTestTemplates();
      })
      .catch((error) => {
        console.error("İstifadəçi məlumatları yüklənərkən xəta:", error);
        alert("Xəta baş verdi: " + error.message);
      });
  });

  // Event listener-lər
  setupEventListeners();
});

// Event listener-ləri qur
function setupEventListeners() {
  // Yeni test yarat düyməsi
  const createBtn = document.getElementById("createTestBtn");
  if (createBtn) {
    createBtn.addEventListener("click", function () {
      window.location.href = "teacher-test-create.html";
    });
  }

  // Tab düymələri
  const libraryTabBtn = document.querySelector('[data-tab="library"]');
  if (libraryTabBtn) {
    libraryTabBtn.addEventListener("click", () => switchTab("library"));
  }

  const activeTabBtn = document.querySelector('[data-tab="active"]');
  if (activeTabBtn) {
    activeTabBtn.addEventListener("click", () => switchTab("active"));
  }

  const completedTabBtn = document.querySelector('[data-tab="completed"]');
  if (completedTabBtn) {
    completedTabBtn.addEventListener("click", () => switchTab("completed"));
  }

  // Çıxış düyməsi
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      auth.signOut().then(() => {
        window.location.href = "index.html";
      });
    });
  }

  // Ana səhifəyə qayıt
  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", function () {
      window.location.href = "teacher-dashboard.html";
    });
  }
}

// Tab-lar arasında keçid
function switchTab(tab) {
  console.log("Tab dəyişdirilir:", tab);
  currentTab = tab;

  // Tab button-larını yenilə
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  // Tab content-ləri yenilə
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });

  const activeContent = document.getElementById(`${tab}Tab`);
  if (activeContent) {
    activeContent.classList.add("active");
  }

  // Məlumatları yüklə
  if (tab === "library") {
    loadTestTemplates();
  } else if (tab === "active") {
    loadActiveTests();
  } else if (tab === "completed") {
    loadCompletedTests();
  }
}

// Test şablonlarını yüklə
function loadTestTemplates() {
  console.log("Test şablonları yüklənir...");
  const container = document.getElementById("testLibrary");

  if (!container) {
    console.error("testLibrary container tapılmadı!");
    return;
  }

  container.innerHTML = '<div class="loading">Yüklənir...</div>';

  db.collection("testTemplates")
    .orderBy("createdAt", "desc")
    .get()
    .then((snapshot) => {
      console.log("Tapılan test sayı:", snapshot.size);

      if (snapshot.empty) {
        container.innerHTML =
          '<div class="no-data">Heç bir test şablonu yoxdur. Yeni test yaratmaq üçün "+" düyməsinə klikləyin.</div>';
        return;
      }

      testTemplates = [];
      snapshot.forEach((doc) => {
        testTemplates.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      displayTestTemplates(testTemplates);
    })
    .catch((error) => {
      console.error("Test şablonları yüklənərkən xəta:", error);
      container.innerHTML = `<div class="error">Xəta: ${error.message}</div>`;
    });
}

// Test şablonlarını göstər
function displayTestTemplates(templates) {
  const container = document.getElementById("testLibrary");

  if (!container || templates.length === 0) {
    container.innerHTML =
      '<div class="no-data">Heç bir test şablonu yoxdur</div>';
    return;
  }

  let html = "";
  templates.forEach((template) => {
    const typeClass =
      template.testType === "quiz" ? "badge-quiz" : "badge-sinaq";
    const typeText =
      template.testType === "quiz" ? "Quiz (15 sual)" : "Sınaq (30 sual)";

    const createdDate = template.createdAt
      ? template.createdAt.toDate().toLocaleDateString("az-AZ")
      : "-";

    html += `
            <div class="test-card">
                <div class="test-header">
                    <div>
                        <div class="test-title">${template.testName}</div>
                        <span class="test-type-badge ${typeClass}">${typeText}</span>
                    </div>
                </div>
                
                <div class="test-info">
                    <div class="info-item">
                        <span>📅</span>
                        <span>Yaradılıb: <strong>${createdDate}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>📝</span>
                        <span>Suallar: <strong>${template.totalQuestions}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>💯</span>
                        <span>Maks bal: <strong>${template.maxScore}</strong></span>
                    </div>
                </div>

                <div class="test-actions">
                    <button class="btn btn-secondary btn-small" onclick="viewTest('${template.id}')">
                        👁️ Baxış
                    </button>
                    <button class="btn btn-warning btn-small" onclick="editTest('${template.id}')">
                        ✏️ Redaktə
                    </button>
                    <button class="btn btn-primary btn-small" onclick="assignTest('${template.id}')">
                        ✅ Qrupa təyin et
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteTemplate('${template.id}')">
                        🗑️ Sil
                    </button>
                </div>
            </div>
        `;
  });

  container.innerHTML = html;
}

// Aktiv testləri yüklə
function loadActiveTests() {
  console.log("Aktiv testlər yüklənir...");
  const container = document.getElementById("activeTests");

  if (!container) {
    console.error("activeTests container tapılmadı!");
    return;
  }

  container.innerHTML = '<div class="loading">Yüklənir...</div>';

  db.collection("activeTests")
    .where("status", "==", "active")
    .orderBy("assignedAt", "desc")
    .get()
    .then((snapshot) => {
      console.log("Tapılan aktiv test sayı:", snapshot.size);

      if (snapshot.empty) {
        container.innerHTML =
          '<div class="no-data">Heç bir aktiv test yoxdur</div>';
        return;
      }

      activeTests = [];
      snapshot.forEach((doc) => {
        activeTests.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      displayActiveTests(activeTests);
    })
    .catch((error) => {
      console.error("Aktiv testlər yüklənərkən xəta:", error);
      container.innerHTML = `<div class="error">Xəta: ${error.message}</div>`;
    });
}

// Aktiv testləri göstər
function displayActiveTests(tests) {
  const container = document.getElementById("activeTests");

  if (!container || tests.length === 0) {
    container.innerHTML =
      '<div class="no-data">Heç bir aktiv test yoxdur</div>';
    return;
  }

  let html = "";
  tests.forEach((test) => {
    const typeClass = test.testType === "quiz" ? "badge-quiz" : "badge-sinaq";
    const typeText = test.testType === "quiz" ? "Quiz" : "Sınaq";

    const startDate = test.startDate
      ? test.startDate.toDate().toLocaleDateString("az-AZ")
      : "-";
    const endDate = test.endDate
      ? test.endDate.toDate().toLocaleDateString("az-AZ")
      : "-";

    const submissions = test.submissions || 0;
    const totalStudents = test.totalStudents || 0;
    const progressPercent =
      totalStudents > 0 ? ((submissions / totalStudents) * 100).toFixed(0) : 0;

    html += `
            <div class="test-card">
                <div class="test-header">
                    <div>
                        <div class="test-title">${test.testName}</div>
                        <span class="test-type-badge ${typeClass}">${typeText}</span>
                    </div>
                    <span class="status-badge status-active">Aktiv</span>
                </div>
                
                <div class="test-info">
                    <div class="info-item">
                        <span>👥</span>
                        <span>Qrup: <strong>${test.groupName}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>📅</span>
                        <span>Başlama: <strong>${startDate}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>📅</span>
                        <span>Bitmə: <strong>${endDate}</strong></span>
                    </div>
                </div>

                <div style="margin-top: 15px;">
                    <div class="progress-text">Göndərmə: ${submissions}/${totalStudents} şagird (${progressPercent}%)</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                </div>

                <div class="test-actions">
                    <button class="btn btn-secondary btn-small" onclick="viewResults('${test.id}')">
                        📊 Nəticələr
                    </button>
                    <button class="btn btn-warning btn-small" onclick="gradeTests('${test.id}')">
                        ✏️ Qiymətləndir
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deactivateTest('${test.id}')">
                        ❌ Deaktiv et
                    </button>
                </div>
            </div>
        `;
  });

  container.innerHTML = html;
}

// Tamamlanmış testləri yüklə
function loadCompletedTests() {
  console.log("Tamamlanmış testlər yüklənir...");
  const container = document.getElementById("completedTests");

  if (!container) {
    console.error("completedTests container tapılmadı!");
    return;
  }

  container.innerHTML = '<div class="loading">Yüklənir...</div>';

  db.collection("activeTests")
    .where("status", "==", "completed")
    .orderBy("assignedAt", "desc")
    .get()
    .then((snapshot) => {
      console.log("Tapılan tamamlanmış test sayı:", snapshot.size);

      if (snapshot.empty) {
        container.innerHTML =
          '<div class="no-data">Heç bir tamamlanmış test yoxdur</div>';
        return;
      }

      completedTests = [];
      snapshot.forEach((doc) => {
        completedTests.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      displayCompletedTests(completedTests);
    })
    .catch((error) => {
      console.error("Tamamlanmış testlər yüklənərkən xəta:", error);
      container.innerHTML = `<div class="error">Xəta: ${error.message}</div>`;
    });
}

// Tamamlanmış testləri göstər
function displayCompletedTests(tests) {
  const container = document.getElementById("completedTests");

  if (!container || tests.length === 0) {
    container.innerHTML =
      '<div class="no-data">Heç bir tamamlanmış test yoxdur</div>';
    return;
  }

  let html = "";
  tests.forEach((test) => {
    const typeClass = test.testType === "quiz" ? "badge-quiz" : "badge-sinaq";
    const typeText = test.testType === "quiz" ? "Quiz" : "Sınaq";

    const endDate = test.endDate
      ? test.endDate.toDate().toLocaleDateString("az-AZ")
      : "-";

    const submissions = test.submissions || 0;
    const totalStudents = test.totalStudents || 0;

    html += `
            <div class="test-card">
                <div class="test-header">
                    <div>
                        <div class="test-title">${test.testName}</div>
                        <span class="test-type-badge ${typeClass}">${typeText}</span>
                    </div>
                    <span class="status-badge status-completed">Tamamlanmış</span>
                </div>
                
                <div class="test-info">
                    <div class="info-item">
                        <span>👥</span>
                        <span>Qrup: <strong>${test.groupName}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>📅</span>
                        <span>Bitmə tarixi: <strong>${endDate}</strong></span>
                    </div>
                    <div class="info-item">
                        <span>📊</span>
                        <span>Göndərmə: <strong>${submissions}/${totalStudents}</strong></span>
                    </div>
                </div>

                <div class="test-actions">
                    <button class="btn btn-secondary btn-small" onclick="viewResults('${test.id}')">
                        📊 Nəticələrə bax
                    </button>
                </div>
            </div>
        `;
  });

  container.innerHTML = html;
}

// Test baxış
function viewTest(templateId) {
  console.log("Test baxışı:", templateId);
  // TODO: Test baxış səhifəsinə keçid
  alert("Test baxış funksiyası hazırlanır...");
}

// Test redaktə et
function editTest(templateId) {
  console.log("Test redaktə edilir:", templateId);
  window.location.href = `teacher-test-create.html?id=${templateId}`;
}

// Qrupa təyin et
function assignTest(templateId) {
  console.log("Qrupa təyin edilir:", templateId);
  window.location.href = `teacher-test-assign.html?templateId=${templateId}`;
}

// Test şablonunu sil
function deleteTemplate(templateId) {
  console.log("Test silinir:", templateId);

  if (
    !confirm(
      "Bu test şablonunu silmək istədiyinizdən əminsiniz?\n\nDiqqət: Bu testi istifadə edən bütün aktiv testlər də təsirlənəcək!"
    )
  ) {
    return;
  }

  db.collection("testTemplates")
    .doc(templateId)
    .delete()
    .then(() => {
      console.log("Test şablonu silindi!");
      alert("Test şablonu silindi!");
      loadTestTemplates();
    })
    .catch((error) => {
      console.error("Test silinərkən xəta:", error);
      alert("Xəta baş verdi: " + error.message);
    });
}

// Nəticələrə bax
function viewResults(activeTestId) {
  console.log("Nəticələr:", activeTestId);
  window.location.href = `teacher-test-results.html?activeTestId=${activeTestId}`;
}

// Testləri qiymətləndir
function gradeTests(activeTestId) {
  console.log("Qiymətləndirmə:", activeTestId);
  window.location.href = `teacher-test-grading.html?activeTestId=${activeTestId}`;
}

// Testi deaktiv et
function deactivateTest(activeTestId) {
  console.log("Test deaktiv edilir:", activeTestId);

  if (
    !confirm(
      "Bu testi deaktiv etmək istədiyinizdən əminsiniz?\n\nŞagirdlər artıq cavab göndərə bilməyəcəklər."
    )
  ) {
    return;
  }

  db.collection("activeTests")
    .doc(activeTestId)
    .update({
      status: "completed",
    })
    .then(() => {
      console.log("Test deaktiv edildi!");
      alert("Test deaktiv edildi!");
      loadActiveTests();
    })
    .catch((error) => {
      console.error("Test deaktiv edilərkən xəta:", error);
      alert("Xəta baş verdi: " + error.message);
    });
}
