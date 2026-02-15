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
let selectedTestType = null;
let editMode = false;
let editTemplateId = null;

// Test strukturları
const testStructures = {
  quiz: {
    totalQuestions: 15,
    closed: 10,
    open: 3,
    writing: 2,
  },
  sinaq: {
    totalQuestions: 30,
    closed: 22,
    open: 5,
    writing: 3,
  },
};

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", function () {
  console.log("Test yaratma səhifəsi yüklənir...");

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

        // Edit mode yoxla
        checkEditMode();
      })
      .catch((error) => {
        console.error("İstifadəçi məlumatları yüklənərkən xəta:", error);
        alert("Xəta baş verdi: " + error.message);
      });
  });

  // Event listener-lər
  setupEventListeners();
});

// Edit mode yoxla
function checkEditMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const templateId = urlParams.get("id");

  if (templateId) {
    editMode = true;
    editTemplateId = templateId;
    document.getElementById("pageTitle").textContent = "✏️ Test Redaktə Et";
    document.getElementById("submitBtn").textContent = "Yenilə";

    // Test məlumatlarını yüklə
    loadTestTemplate(templateId);
  }
}

// Test şablonunu yüklə (edit mode)
function loadTestTemplate(templateId) {
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

      const template = doc.data();
      console.log("Test məlumatları:", template);

      // Test növünü seç
      document.querySelector(
        `input[name="testType"][value="${template.testType}"]`
      ).checked = true;
      selectedTestType = template.testType;
      updateRadioSelection();
      generateAnswerFields(template.testType);

      // Test adını doldur
      document.getElementById("testName").value = template.testName;

      // PDF URL doldur
      if (template.pdfUrl) {
        document.getElementById("pdfUrl").value = template.pdfUrl;
      }

      // Cavab açarını doldur
      if (template.answerKey) {
        // Qapalı suallar
        if (template.answerKey.closed) {
          template.answerKey.closed.forEach((answer, index) => {
            const select = document.getElementById(`closed_${index + 1}`);
            if (select) select.value = answer;
          });
        }

        // Açıq suallar
        if (template.answerKey.open) {
          template.answerKey.open.forEach((answer, index) => {
            const input = document.getElementById(`open_${index + 1}`);
            if (input) input.value = answer;
          });
        }
      }
    })
    .catch((error) => {
      console.error("Test yüklənərkən xəta:", error);
      alert("Xəta: " + error.message);
    });
}

// Event listener-ləri qur
function setupEventListeners() {
  // Test növü seçimi
  document.querySelectorAll('input[name="testType"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      selectedTestType = this.value;
      updateRadioSelection();
      generateAnswerFields(this.value);
    });
  });

  // Radio option click
  document.getElementById("quizOption").addEventListener("click", function () {
    document.querySelector('input[name="testType"][value="quiz"]').click();
  });

  document.getElementById("sinaqOption").addEventListener("click", function () {
    document.querySelector('input[name="testType"][value="sinaq"]').click();
  });

  // Form submit
  document.getElementById("testForm").addEventListener("submit", saveTest);

  // Cancel button
  document.getElementById("cancelBtn").addEventListener("click", function () {
    if (
      confirm("Dəyişikliklər yadda saxlanılmayacaq. Davam etmək istəyirsiniz?")
    ) {
      window.location.href = "teacher-tests.html";
    }
  });

  // Back button
  document.getElementById("backBtn").addEventListener("click", function () {
    window.location.href = "teacher-tests.html";
  });
}

// Radio seçimini yenilə
function updateRadioSelection() {
  document.querySelectorAll(".radio-option").forEach((opt) => {
    opt.classList.remove("selected");
  });

  if (selectedTestType === "quiz") {
    document.getElementById("quizOption").classList.add("selected");
  } else if (selectedTestType === "sinaq") {
    document.getElementById("sinaqOption").classList.add("selected");
  }
}

// Cavab sahələrini yarat
function generateAnswerFields(testType) {
  const structure = testStructures[testType];

  if (!structure) {
    console.error("Test strukturu tapılmadı:", testType);
    return;
  }

  // Cavab açarı bölməsini göstər
  document.getElementById("answerKeySection").style.display = "block";

  // Sayları yenilə
  document.getElementById("closedCount").textContent = structure.closed;
  document.getElementById("openCount").textContent = structure.open;
  document.getElementById("writingCount").textContent = structure.writing;

  // Qapalı suallar
  const closedContainer = document.getElementById("closedAnswers");
  closedContainer.innerHTML = "";

  for (let i = 1; i <= structure.closed; i++) {
    const div = document.createElement("div");
    div.className = "answer-item";
    div.innerHTML = `
            <label class="answer-label">Sual ${i}</label>
            <select class="answer-select" id="closed_${i}" required>
                <option value="">Seç</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
            </select>
        `;
    closedContainer.appendChild(div);
  }

  // Açıq suallar
  const openContainer = document.getElementById("openAnswers");
  openContainer.innerHTML = "";

  for (let i = 1; i <= structure.open; i++) {
    const questionNum = structure.closed + i;
    const div = document.createElement("div");
    div.className = "answer-item";
    div.innerHTML = `
            <label class="answer-label">Sual ${questionNum}</label>
            <input type="number" class="answer-input" id="open_${i}" placeholder="Rəqəm" required>
        `;
    openContainer.appendChild(div);
  }
}

// Google Drive linkini formatla
function formatGoogleDriveUrl(url) {
  // Müxtəlif Google Drive formatlarını dəstəklə
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];

  for (let pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      // Embedded view üçün format
      return `https://drive.google.com/file/d/${match[1]}/preview`;
    }
  }

  // Əgər artıq düzgün formatdadırsa, olduğu kimi qaytar
  return url;
}

// Testi yadda saxla
function saveTest(e) {
  e.preventDefault();
  console.log("Test yadda saxlanır...");

  const testName = document.getElementById("testName").value.trim();
  const testType = selectedTestType;
  let pdfUrl = document.getElementById("pdfUrl").value.trim();

  if (!testType) {
    alert("Test növünü seçin!");
    return;
  }

  if (!testName) {
    alert("Test adını daxil edin!");
    return;
  }

  if (!pdfUrl) {
    alert("PDF linkini daxil edin!");
    return;
  }

  // Google Drive linkini formatla
  pdfUrl = formatGoogleDriveUrl(pdfUrl);
  console.log("Formatlanmış PDF URL:", pdfUrl);

  // Cavab açarını yığ
  const structure = testStructures[testType];
  const answerKey = {
    closed: [],
    open: [],
    writing: null,
  };

  // Qapalı cavabları yığ
  for (let i = 1; i <= structure.closed; i++) {
    const answer = document.getElementById(`closed_${i}`).value;
    if (!answer) {
      alert(`Qapalı sual ${i} üçün cavab seçin!`);
      return;
    }
    answerKey.closed.push(answer);
  }

  // Açıq cavabları yığ
  for (let i = 1; i <= structure.open; i++) {
    const answer = document.getElementById(`open_${i}`).value;
    if (!answer) {
      alert(`Açıq sual ${structure.closed + i} üçün cavab daxil edin!`);
      return;
    }
    answerKey.open.push(parseInt(answer));
  }

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = editMode ? "Yenilənir..." : "Yadda saxlanır...";

  // Birbaşa Firestore-a yaz
  saveTestToFirestore(
    testName,
    testType,
    structure,
    answerKey,
    pdfUrl,
    submitBtn
  );
}

// Testi Firestore-a saxla
function saveTestToFirestore(
  testName,
  testType,
  structure,
  answerKey,
  pdfUrl,
  submitBtn
) {
  const testData = {
    testName: testName,
    testType: testType,
    totalQuestions: structure.totalQuestions,
    questionStructure: {
      closed: structure.closed,
      open: structure.open,
      writing: structure.writing,
    },
    answerKey: answerKey,
    pdfUrl: pdfUrl,
    maxScore: 100,
  };

  let promise;

  if (editMode) {
    // Update
    testData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    testData.updatedBy = auth.currentUser.email;
    promise = db
      .collection("testTemplates")
      .doc(editTemplateId)
      .update(testData);
  } else {
    // Create
    testData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    testData.createdBy = auth.currentUser.email;
    promise = db.collection("testTemplates").add(testData);
  }

  promise
    .then(() => {
      console.log("Test yadda saxlanıldı!");
      alert(editMode ? "Test yeniləndi!" : "Test uğurla yaradıldı!");
      window.location.href = "teacher-tests.html";
    })
    .catch((error) => {
      console.error("Test saxlanılarkən xəta:", error);
      alert("Xəta baş verdi: " + error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = editMode ? "Yenilə" : "Yadda saxla";
    });
}
