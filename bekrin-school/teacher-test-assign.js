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
let templateId = null;
let testTemplate = null;
let allGroups = [];
let selectedDuration = 40; // default 40 dəqiqə

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", function () {
  console.log("Təyin etmə səhifəsi yüklənir...");

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

        // Template ID-ni al
        const urlParams = new URLSearchParams(window.location.search);
        templateId = urlParams.get("templateId");

        if (!templateId) {
          alert("Test ID tapılmadı!");
          window.location.href = "teacher-tests.html";
          return;
        }

        // Məlumatları yüklə
        loadTestTemplate();
        loadGroups();
        setDefaultDates();
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
  // Form submit
  document.getElementById("assignForm").addEventListener("submit", assignTest);

  // Cancel button
  document.getElementById("cancelBtn").addEventListener("click", function () {
    window.location.href = "teacher-tests.html";
  });

  // Back button
  document.getElementById("backBtn").addEventListener("click", function () {
    window.location.href = "teacher-tests.html";
  });

  // Qrup seçimi dəyişdikdə şagird sayını göstər
  document
    .getElementById("groupSelect")
    .addEventListener("change", function () {
      const groupName = this.value;
      if (groupName) {
        showStudentCount(groupName);
      } else {
        document.getElementById("studentCount").style.display = "none";
      }
    });

  // Timer seçimləri
  document.querySelectorAll(".timer-option").forEach((option) => {
    option.addEventListener("click", function () {
      // Əvvəlki seçimi sil
      document.querySelectorAll(".timer-option").forEach((opt) => {
        opt.classList.remove("selected");
      });

      // Yeni seçimi təyin et
      this.classList.add("selected");
      const radio = this.querySelector('input[type="radio"]');
      radio.checked = true;
      selectedDuration = parseInt(radio.value);

      console.log("Seçilən müddət:", selectedDuration, "dəqiqə");
    });
  });

  // Radio button dəyişikliyi
  document.querySelectorAll('input[name="duration"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      selectedDuration = parseInt(this.value);
      console.log("Müddət dəyişdi:", selectedDuration, "dəqiqə");
    });
  });
}

// Test şablonunu yüklə
function loadTestTemplate() {
  console.log("Test şablonu yüklənir:", templateId);

  db.collection("testTemplates")
    .doc(templateId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        alert("Test tapılmadı!");
        window.location.href = "teacher-tests.html";
        return;
      }

      testTemplate = {
        id: doc.id,
        ...doc.data(),
      };

      console.log("Test məlumatları:", testTemplate);
      displayTestInfo(testTemplate);
    })
    .catch((error) => {
      console.error("Test yüklənərkən xəta:", error);
      alert("Xəta: " + error.message);
    });
}

// Test məlumatlarını göstər
function displayTestInfo(template) {
  const container = document.getElementById("testInfoCard");

  const typeClass = template.testType === "quiz" ? "badge-quiz" : "badge-sinaq";
  const typeText =
    template.testType === "quiz" ? "Quiz (15 sual)" : "Sınaq (30 sual)";

  const createdDate = template.createdAt
    ? template.createdAt.toDate().toLocaleDateString("az-AZ")
    : "-";

  container.innerHTML = `
        <div class="test-title">${template.testName}</div>
        <span class="test-type-badge ${typeClass}">${typeText}</span>
        
        <div class="test-details">
            <div class="detail-item">
                <span>📅</span>
                <span>Yaradılıb: <strong>${createdDate}</strong></span>
            </div>
            <div class="detail-item">
                <span>📝</span>
                <span>Suallar: <strong>${template.totalQuestions}</strong></span>
            </div>
            <div class="detail-item">
                <span>💯</span>
                <span>Maks bal: <strong>${template.maxScore}</strong></span>
            </div>
        </div>
    `;
}

// Qrupları yüklə
function loadGroups() {
  console.log("Qruplar yüklənir...");

  // Əvvəlcə active: true ilə yoxla
  db.collection("groups")
    .where("active", "==", true)
    .get()
    .then((snapshot) => {
      console.log("Active qruplar:", snapshot.size);

      if (snapshot.empty) {
        // Əgər active qrup yoxdursa, hamısını yüklə
        console.log("Active qrup yoxdur, hamısını yüklə...");
        return db.collection("groups").get();
      }

      return snapshot;
    })
    .then((snapshot) => {
      console.log("Tapılan qrup sayı:", snapshot.size);

      allGroups = [];
      snapshot.forEach((doc) => {
        allGroups.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      console.log("Yüklənən qruplar:", allGroups);

      if (allGroups.length === 0) {
        alert("Heç bir qrup tapılmadı! Əvvəlcə qrup yaratmalısınız.");
        const select = document.getElementById("groupSelect");
        select.innerHTML =
          '<option value="">Qrup yoxdur - əvvəlcə qrup yaradın</option>';
      } else {
        populateGroupSelect();
      }
    })
    .catch((error) => {
      console.error("Qruplar yüklənərkən xəta:", error);
      alert("Qruplar yüklənərkən xəta: " + error.message);

      // Xəta olsa belə, empty state göstər
      const select = document.getElementById("groupSelect");
      select.innerHTML = '<option value="">Xəta baş verdi</option>';
    });
}

// Qrup dropdown-unu doldur
function populateGroupSelect() {
  const select = document.getElementById("groupSelect");
  select.innerHTML = '<option value="">Qrup seçin</option>';

  // Ad-a görə sırala
  allGroups.sort((a, b) => {
    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    return nameA.localeCompare(nameB, "az");
  });

  allGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.name;
    option.textContent = group.name;
    select.appendChild(option);
  });

  console.log("Qrup dropdown dolduruldu:", allGroups.length, "qrup");
}

// Şagird sayını göstər
function showStudentCount(groupName) {
  const group = allGroups.find((g) => g.name === groupName);

  if (group) {
    const studentCount = group.students ? group.students.length : 0;
    document.getElementById("studentCountNum").textContent = studentCount;
    document.getElementById("studentCount").style.display = "block";
  }
}

// Default tarixləri təyin et
function setDefaultDates() {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Başlama tarixi: bu gün
  document.getElementById("startDate").value = todayStr;
  document.getElementById("startDate").min = todayStr;

  // Bitmə tarixi: 7 gün sonra
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];
  document.getElementById("endDate").value = nextWeekStr;
  document.getElementById("endDate").min = todayStr;
}

// Testi təyin et
function assignTest(e) {
  e.preventDefault();
  console.log("Test təyin edilir...");

  const groupName = document.getElementById("groupSelect").value;
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const activateNow = document.getElementById("activateNow").checked;
  const duration = selectedDuration;

  // Validasiya
  if (!groupName) {
    alert("Qrup seçin!");
    return;
  }

  if (!startDate || !endDate) {
    alert("Tarixləri daxil edin!");
    return;
  }

  if (!duration) {
    alert("Test müddətini seçin!");
    return;
  }

  // Tarix yoxlaması
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end <= start) {
    alert("Bitmə tarixi başlama tarixindən sonra olmalıdır!");
    return;
  }

  // Qrupda neçə şagird var
  const group = allGroups.find((g) => g.name === groupName);
  const totalStudents = group && group.students ? group.students.length : 0;

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Təyin edilir...";

  // Aktiv test yarat
  const activeTestData = {
    templateId: templateId,
    testName: testTemplate.testName,
    testType: testTemplate.testType,
    groupName: groupName,
    startDate: firebase.firestore.Timestamp.fromDate(start),
    endDate: firebase.firestore.Timestamp.fromDate(end),
    duration: duration, // dəqiqə ilə
    status: activateNow ? "active" : "waiting",
    submissions: 0,
    totalStudents: totalStudents,
    assignedBy: auth.currentUser.email,
    assignedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  console.log("Aktiv test məlumatları:", activeTestData);

  db.collection("activeTests")
    .add(activeTestData)
    .then(() => {
      console.log("Test təyin edildi!");
      alert(
        `Test "${groupName}" qrupuna təyin edildi!\nMüddət: ${duration} dəqiqə`
      );
      window.location.href = "teacher-tests.html";
    })
    .catch((error) => {
      console.error("Test təyin edilərkən xəta:", error);
      alert("Xəta baş verdi: " + error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Təyin et";
    });
}
