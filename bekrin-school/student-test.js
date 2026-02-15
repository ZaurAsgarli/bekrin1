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

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Global dəyişənlər
let activeTestId = null;
let activeTest = null;
let testTemplate = null;
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let timerInterval = null;
let studentAnswers = {
  closed: [],
  open: [],
  writing: [],
};
let canvasContexts = {}; // Her yazı sualı üçün canvas context
let isDrawing = false;
let currentCanvas = null;

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", function () {
  console.log("Test səhifəsi yüklənir...");

  // Auth yoxlama
  auth.onAuthStateChanged((user) => {
    if (!user) {
      console.log("İstifadəçi daxil olmayıb");
      window.location.href = "index.html";
      return;
    }

    console.log("İstifadəçi:", user.email);

    // Şagird rolunu yoxla
    db.collection("users")
      .doc(user.email)
      .get()
      .then((doc) => {
        if (!doc.exists || doc.data().role !== "student") {
          alert("Bu səhifəyə yalnız şagirdlər daxil ola bilər!");
          window.location.href = "index.html";
          return;
        }

        console.log("Şagird təsdiqləndi:", doc.data());

        // Test ID-ni al
        const urlParams = new URLSearchParams(window.location.search);
        activeTestId = urlParams.get("activeTestId");

        if (!activeTestId) {
          alert("Test ID tapılmadı!");
          window.location.href = "student-dashboard.html";
          return;
        }

        // Testi yüklə
        loadTest();
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
  // Submit düyməsi
  document.getElementById("submitBtn").addEventListener("click", submitTest);

  // PDF navigation
  document.getElementById("prevPageBtn").addEventListener("click", prevPage);
  document.getElementById("nextPageBtn").addEventListener("click", nextPage);
}

// Testi yüklə
function loadTest() {
  console.log("Test yüklənir:", activeTestId);

  db.collection("activeTests")
    .doc(activeTestId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        alert("Test tapılmadı!");
        window.location.href = "student-dashboard.html";
        return;
      }

      activeTest = {
        id: doc.id,
        ...doc.data(),
      };

      console.log("Aktiv test:", activeTest);

      // Test şablonunu yüklə
      return db.collection("testTemplates").doc(activeTest.templateId).get();
    })
    .then((doc) => {
      if (!doc.exists) {
        alert("Test şablonu tapılmadı!");
        return;
      }

      testTemplate = {
        id: doc.id,
        ...doc.data(),
      };

      console.log("Test şablonu:", testTemplate);

      // UI-ı göstər
      displayTest();
    })
    .catch((error) => {
      console.error("Test yüklənərkən xəta:", error);
      alert("Xəta: " + error.message);
    });
}

// Testi göstər
function displayTest() {
  // Test adını göstər
  document.getElementById("testNameDisplay").textContent =
    testTemplate.testName;

  // Sual sayını göstər
  document.getElementById("totalQuestions").textContent =
    testTemplate.totalQuestions;

  // Cavab panelini yarat
  generateAnswerPanel();

  // PDF-i yüklə
  loadPDF(testTemplate.pdfUrl);

  // Timer-i başlat
  startTimer(activeTest.duration);

  // Loading-i gizlət
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("timerBar").style.display = "flex";
  document.getElementById("testContainer").style.display = "flex";
}

// Cavab panelini yarat
function generateAnswerPanel() {
  const container = document.getElementById("answersList");
  container.innerHTML = "";

  const structure = testTemplate.questionStructure;
  let questionNum = 1;

  // Qapalı suallar
  for (let i = 0; i < structure.closed; i++) {
    const div = document.createElement("div");
    div.className = "question-item";
    div.id = `question-${questionNum}`;
    div.innerHTML = `
            <div class="question-number">
                Sual ${questionNum}
                <span class="question-type-badge badge-closed">Qapalı</span>
            </div>
            <div class="radio-options">
                ${["A", "B", "C", "D", "E"]
                  .map(
                    (option) => `
                    <div class="radio-option">
                        <input type="radio" name="q${questionNum}" value="${option}" 
                               id="q${questionNum}_${option}"
                               onchange="handleAnswer(${questionNum}, 'closed', '${option}')">
                        <label for="q${questionNum}_${option}">${option}</label>
                    </div>
                `
                  )
                  .join("")}
            </div>
        `;
    container.appendChild(div);
    studentAnswers.closed.push(null);
    questionNum++;
  }

  // Açıq suallar
  for (let i = 0; i < structure.open; i++) {
    const div = document.createElement("div");
    div.className = "question-item";
    div.id = `question-${questionNum}`;
    div.innerHTML = `
            <div class="question-number">
                Sual ${questionNum}
                <span class="question-type-badge badge-open">Açıq</span>
            </div>
            <input type="number" class="open-input" placeholder="Cavabı daxil edin (rəqəm)"
                   onchange="handleAnswer(${questionNum}, 'open', this.value)">
        `;
    container.appendChild(div);
    studentAnswers.open.push(null);
    questionNum++;
  }

  // Yazı işləri
  for (let i = 0; i < structure.writing; i++) {
    const canvasId = `canvas-${questionNum}`;
    const div = document.createElement("div");
    div.className = "question-item";
    div.id = `question-${questionNum}`;
    div.innerHTML = `
            <div class="question-number">
                Sual ${questionNum}
                <span class="question-type-badge badge-writing">Yazı</span>
            </div>
            <div class="canvas-container">
                <div class="canvas-tools">
                    <button class="tool-btn active" onclick="setDrawingTool('${canvasId}', 'pen')">✏️ Qələm</button>
                    <button class="tool-btn" onclick="setDrawingTool('${canvasId}', 'eraser')">🧹 Silgi</button>
                    <button class="tool-btn" onclick="clearCanvas('${canvasId}')">🗑️ Təmizlə</button>
                </div>
                <canvas class="writing-canvas" id="${canvasId}" width="360" height="300"></canvas>
            </div>
        `;
    container.appendChild(div);
    studentAnswers.writing.push(null);

    // Canvas-ı inisializə et
    setTimeout(() => initCanvas(canvasId, questionNum), 100);

    questionNum++;
  }
}

// Canvas-ı inisializə et
function initCanvas(canvasId, questionNum) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  canvasContexts[canvasId] = {
    canvas: canvas,
    ctx: ctx,
    drawing: false,
    tool: "pen",
    questionNum: questionNum,
  };

  // Mouse events
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);

  // Touch events (mobil üçün)
  canvas.addEventListener("touchstart", handleTouch);
  canvas.addEventListener("touchmove", handleTouch);
  canvas.addEventListener("touchend", stopDrawing);
}

// Çəkməyə başla
function startDrawing(e) {
  const canvasId = e.target.id;
  const context = canvasContexts[canvasId];
  if (!context) return;

  context.drawing = true;
  const rect = context.canvas.getBoundingClientRect();
  context.lastX = e.clientX - rect.left;
  context.lastY = e.clientY - rect.top;
}

// Çək
function draw(e) {
  const canvasId = e.target.id;
  const context = canvasContexts[canvasId];
  if (!context || !context.drawing) return;

  e.preventDefault();

  const rect = context.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  context.ctx.beginPath();
  context.ctx.moveTo(context.lastX, context.lastY);
  context.ctx.lineTo(x, y);

  if (context.tool === "pen") {
    context.ctx.strokeStyle = "#000";
    context.ctx.lineWidth = 2;
  } else if (context.tool === "eraser") {
    context.ctx.strokeStyle = "#fff";
    context.ctx.lineWidth = 20;
  }

  context.ctx.stroke();

  context.lastX = x;
  context.lastY = y;

  // Cavabı yadda saxla
  saveCanvasAnswer(canvasId, context.questionNum);
}

// Çəkməni dayandır
function stopDrawing(e) {
  const canvasId = e.target.id;
  const context = canvasContexts[canvasId];
  if (context) {
    context.drawing = false;
  }
}

// Touch event handler
function handleTouch(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent(
    e.type === "touchstart" ? "mousedown" : "mousemove",
    {
      clientX: touch.clientX,
      clientY: touch.clientY,
    }
  );
  e.target.dispatchEvent(mouseEvent);
}

// Çəkmə alətini dəyişdir
function setDrawingTool(canvasId, tool) {
  const context = canvasContexts[canvasId];
  if (context) {
    context.tool = tool;

    // Button aktiv state
    const container = document.getElementById(canvasId).parentElement;
    container.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    event.target.classList.add("active");
  }
}

// Canvas-ı təmizlə
function clearCanvas(canvasId) {
  const context = canvasContexts[canvasId];
  if (context) {
    context.ctx.clearRect(0, 0, context.canvas.width, context.canvas.height);
    saveCanvasAnswer(canvasId, context.questionNum);
  }
}

// Canvas cavabını saxla
function saveCanvasAnswer(canvasId, questionNum) {
  const context = canvasContexts[canvasId];
  if (context) {
    const imageData = context.canvas.toDataURL("image/png");
    const writingIndex =
      questionNum -
      testTemplate.questionStructure.closed -
      testTemplate.questionStructure.open -
      1;
    studentAnswers.writing[writingIndex] = imageData;

    updateAnswerCount();
    markQuestionAnswered(questionNum);
  }
}

// Cavabı işlə
function handleAnswer(questionNum, type, value) {
  if (type === "closed") {
    const closedIndex = questionNum - 1;
    studentAnswers.closed[closedIndex] = value;
  } else if (type === "open") {
    const openIndex = questionNum - testTemplate.questionStructure.closed - 1;
    studentAnswers.open[openIndex] = value ? parseInt(value) : null;
  }

  updateAnswerCount();
  markQuestionAnswered(questionNum);
}

// Cavablandırılmış sayını yenilə
function updateAnswerCount() {
  const closedAnswered = studentAnswers.closed.filter((a) => a !== null).length;
  const openAnswered = studentAnswers.open.filter((a) => a !== null).length;
  const writingAnswered = studentAnswers.writing.filter(
    (a) => a !== null
  ).length;

  const total = closedAnswered + openAnswered + writingAnswered;
  document.getElementById("answeredCount").textContent = total;
}

// Sualı cavablandırılmış kimi işarələ
function markQuestionAnswered(questionNum) {
  const questionEl = document.getElementById(`question-${questionNum}`);
  if (questionEl) {
    questionEl.classList.add("answered");
  }
}

// Timer-i başlat
function startTimer(durationMinutes) {
  const endTime = Date.now() + durationMinutes * 60 * 1000;

  function updateTimer() {
    const remaining = endTime - Date.now();

    if (remaining <= 0) {
      // Vaxt bitdi - avtomatik submit
      clearInterval(timerInterval);
      autoSubmitTest();
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    const timerText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    document.getElementById("timerText").textContent = timerText;

    // Son 5 dəqiqə - xəbərdarlıq
    const timerDisplay = document.getElementById("timerDisplay");
    if (remaining <= 5 * 60 * 1000) {
      timerDisplay.classList.add("warning");
    } else {
      timerDisplay.classList.remove("warning");
    }
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

// PDF-i yüklə
function loadPDF(pdfUrl) {
  console.log("PDF yüklənir:", pdfUrl);

  pdfjsLib
    .getDocument(pdfUrl)
    .promise.then((pdf) => {
      pdfDoc = pdf;
      totalPages = pdf.numPages;
      document.getElementById("totalPages").textContent = totalPages;

      renderPage(1);
    })
    .catch((error) => {
      console.error("PDF yüklənərkən xəta:", error);
      alert("PDF yüklənmədi: " + error.message);
    });
}

// Səhifəni render et
function renderPage(pageNum) {
  if (!pdfDoc) return;

  pdfDoc.getPage(pageNum).then((page) => {
    const canvas = document.getElementById("pdfCanvas");
    const ctx = canvas.getContext("2d");

    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    page.render(renderContext);

    currentPage = pageNum;
    document.getElementById("currentPage").textContent = pageNum;

    // Button state-lərini yenilə
    document.getElementById("prevPageBtn").disabled = pageNum <= 1;
    document.getElementById("nextPageBtn").disabled = pageNum >= totalPages;
  });
}

// Əvvəlki səhifə
function prevPage() {
  if (currentPage > 1) {
    renderPage(currentPage - 1);
  }
}

// Növbəti səhifə
function nextPage() {
  if (currentPage < totalPages) {
    renderPage(currentPage + 1);
  }
}

// Testi göndər
function submitTest() {
  if (
    !confirm(
      "Testi göndərmək istədiyinizdən əminsiniz?\n\nGöndərdikdən sonra dəyişiklik edə bilməyəcəksiniz."
    )
  ) {
    return;
  }

  performSubmit();
}

// Avtomatik göndər (vaxt bitdikdə)
function autoSubmitTest() {
  alert("Vaxt bitdi! Cavablarınız avtomatik olaraq göndərilir...");
  performSubmit();
}

// Submit əməliyyatını həyata keçir
function performSubmit() {
  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Göndərilir...";

  // Timer-i dayandır
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Cavabları Firestore-a yaz
  const submissionData = {
    activeTestId: activeTestId,
    templateId: testTemplate.id,
    testName: testTemplate.testName,
    studentEmail: auth.currentUser.email,
    groupName: activeTest.groupName,
    answers: {
      closed: studentAnswers.closed,
      open: studentAnswers.open,
      writing: studentAnswers.writing,
    },
    autoScore: null, // Server-də hesablanacaq
    writingScores: null,
    finalScore: null,
    percentage: null,
    rank: null,
    status: "pending",
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  console.log("Göndərilən məlumatlar:", submissionData);

  db.collection("studentTests")
    .add(submissionData)
    .then(() => {
      // Aktiv testdəki submission sayını artır
      return db
        .collection("activeTests")
        .doc(activeTestId)
        .update({
          submissions: firebase.firestore.FieldValue.increment(1),
        });
    })
    .then(() => {
      console.log("Test göndərildi!");
      alert(
        "Test uğurla göndərildi! Müəllim yoxladıqdan sonra nəticəni görə biləcəksiniz."
      );
      window.location.href = "student-dashboard.html";
    })
    .catch((error) => {
      console.error("Test göndərilərkən xəta:", error);
      alert("Xəta baş verdi: " + error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Göndər";
    });
}
