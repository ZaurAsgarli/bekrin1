// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753"
};



if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let pyodide = null;
let allTopics = [];
let allExercises = [];
let studentProgress = null;
let currentExercise = null;
let hintUsed = false;

// Pyodide yüklə
async function loadPyodideEnvironment() {
  try {
    console.log("🔄 Pyodide yüklənir...");
    pyodide = await loadPyodide();
    console.log("✅ Pyodide yükləndi");
  } catch (error) {
    console.error("❌ Pyodide yüklənmədi:", error);
    alert("Python mühiti yüklənmədi. Səhifəni yeniləyin.");
  }
}

// Auth yoxlama
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;

  try {
    const userDoc = await db.collection("users").doc(user.email).get();
    if (!userDoc.exists || userDoc.data().role !== "student") {
      alert("Bu səhifəyə yalnız şagirdlər daxil ola bilər!");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }

    document.getElementById("studentName").textContent =
      userDoc.data().fullName || user.email;

    await loadPyodideEnvironment();
    await loadData();
  } catch (error) {
    console.error("Xəta:", error);
    alert("Xəta baş verdi: " + error.message);
  }
});

// Məlumatları yüklə
async function loadData() {
  try {
    const topicsSnapshot = await db
      .collection("codingTopics")
      .orderBy("order", "asc")
      .get();
    allTopics = topicsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const exercisesSnapshot = await db
      .collection("codingExercises")
      .orderBy("order", "asc")
      .get();
    allExercises = exercisesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const progressDoc = await db
      .collection("studentCodingProgress")
      .doc(currentUser.email)
      .get();

    if (progressDoc.exists) {
      studentProgress = progressDoc.data();
    } else {
      studentProgress = {
        completedExercises: [],
        totalPoints: 0,
        submissions: {},
      };
      await db
        .collection("studentCodingProgress")
        .doc(currentUser.email)
        .set(studentProgress);
    }

    displayTopics();
    updateStats();

    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("content").style.display = "block";
  } catch (error) {
    console.error("Məlumatlar yüklənərkən xəta:", error);
    alert("Xəta: " + error.message);
  }
}

// Mövzuları göstər
function displayTopics() {
  const container = document.getElementById("topicsList");
  let html = "";

  allTopics.forEach((topic) => {
    const topicExercises = allExercises.filter((ex) => ex.topicId === topic.id);

    html += `<div class="topic-section">`;
    html += `<div class="topic-title">${topic.title}</div>`;

    topicExercises.forEach((ex) => {
      const isCompleted = studentProgress.completedExercises.includes(ex.id);
      const statusIcon = isCompleted ? "✅" : "🔓";
      const classes = `exercise-item ${isCompleted ? "completed" : ""}`;

      html += `
        <div class="${classes}" onclick="selectExercise('${ex.id}')">
          <div>
            <span class="exercise-status">${statusIcon}</span>
            <strong>${ex.order}. ${ex.title}</strong>
          </div>
          <div class="exercise-points">⭐ ${ex.points} xal</div>
        </div>
      `;
    });

    html += `</div>`;
  });

  container.innerHTML = html || '<p style="color: #999;">Tapşırıq yoxdur</p>';
}

// Tapşırığı seç
function selectExercise(exerciseId) {
  currentExercise = allExercises.find((ex) => ex.id === exerciseId);
  if (!currentExercise) return;

  hintUsed = false;

  document.querySelectorAll(".exercise-item").forEach((el) => {
    el.classList.remove("active");
  });
  event.target.closest(".exercise-item").classList.add("active");

  displayExercise();
}

// Tapşırığı göstər
function displayExercise() {
  const workspace = document.getElementById("exerciseWorkspace");

  let testCasesHTML = currentExercise.testCases
    .map(
      (test, i) => `
      <div class="test-case">
        <strong>Test ${i + 1}:</strong> 
        Input: <code>${test.input || "(boş)"}</code> → 
        Output: <code>${test.expectedOutput}</code>
      </div>
    `
    )
    .join("");

  const savedCode =
    studentProgress.submissions[currentExercise.id]?.code || "";

  const difficultyClass =
    currentExercise.difficulty === "easy"
      ? "difficulty-easy"
      : currentExercise.difficulty === "medium"
      ? "difficulty-medium"
      : "difficulty-hard";

  const difficultyText =
    currentExercise.difficulty === "easy"
      ? "Asan"
      : currentExercise.difficulty === "medium"
      ? "Orta"
      : "Çətin";

  workspace.innerHTML = `
    <div class="task-header">
      <div class="task-title">${currentExercise.order}. ${currentExercise.title}</div>
      <span class="task-difficulty ${difficultyClass}">${difficultyText}</span>
      <span style="color: #f59e0b; font-weight: bold; margin-left: 10px;">⭐ ${currentExercise.points} xal</span>
    </div>

    <div class="task-description">
      <strong>📝 Tapşırıq:</strong><br><br>
      ${currentExercise.description}
    </div>

    <div class="test-cases">
      <h4>🧪 Test Nümunələri:</h4>
      ${testCasesHTML}
    </div>

    <div class="hint-box" id="hintBox">
      <h4>💡 İpucu (-5 xal):</h4>
      <p>${currentExercise.hint}</p>
    </div>

    <div class="code-editor">
      <h4>💻 Kod Editoru:</h4>
      <textarea id="codeInput" placeholder="Kodunuzu bura yazın...">${savedCode}</textarea>
    </div>

    <div class="action-buttons">
      <button class="btn btn-hint" onclick="showHint()">💡 İpucu</button>
      <button class="btn btn-run" onclick="runCode()">▶ Yoxla</button>
      <button class="btn btn-clear" onclick="clearCode()">↻ Təmizlə</button>
    </div>

    <div class="output-section">
      <h4>📊 Nəticə:</h4>
      <div id="output" style="color: #999;">Kodu yoxlamaq üçün "Yoxla" düyməsinə basın</div>
    </div>
  `;
}

// İpucu göstər
function showHint() {
  const hintBox = document.getElementById("hintBox");
  if (hintBox) {
    hintBox.style.display = "block";
    hintUsed = true;
  }
}

// Kodu yoxla
async function runCode() {
  if (!pyodide) {
    alert("Python mühiti hələ yüklənməyib. Zəhmət olmasa bir az gözləyin...");
    return;
  }

  const code = document.getElementById("codeInput").value.trim();
  if (!code) {
    alert("Kod yazın!");
    return;
  }

  const outputDiv = document.getElementById("output");
  outputDiv.innerHTML = '<div style="color: #667eea;">🔄 Yoxlanılır...</div>';

  let passedTests = 0;
  let resultsHTML = "";

  for (let i = 0; i < currentExercise.testCases.length; i++) {
    const testCase = currentExercise.testCases[i];

    try {
      const inputData = (testCase.input || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");

      await pyodide.runPythonAsync(`
import sys
from io import StringIO

sys.stdin = StringIO("${inputData}")
sys.stdout = StringIO()
sys.stderr = StringIO()
      `);

      await pyodide.runPythonAsync(code);

      const output = await pyodide.runPythonAsync("sys.stdout.getvalue()");
      const cleanOutput = output.trim();
      const expectedOutput = testCase.expectedOutput.trim();

      if (cleanOutput === expectedOutput) {
        passedTests++;
        resultsHTML += `
          <div class="test-result pass">
            ✅ Test ${i + 1}: Uğurlu<br>
            Gözlənilən: "${expectedOutput}"<br>
            Alınan: "${cleanOutput}"
          </div>
        `;
      } else {
        resultsHTML += `
          <div class="test-result fail">
            ❌ Test ${i + 1}: Uğursuz<br>
            Gözlənilən: "${expectedOutput}"<br>
            Alınan: "${cleanOutput}"
          </div>
        `;
      }
    } catch (error) {
      let errorMsg = error.message;
      if (errorMsg.includes("Traceback")) {
        const lines = errorMsg.split("\n");
        errorMsg = lines[lines.length - 1] || errorMsg;
      }

      resultsHTML += `
        <div class="test-result fail">
          ❌ Test ${i + 1}: Xəta<br>
          <strong>${errorMsg}</strong>
        </div>
      `;
    }
  }

  outputDiv.innerHTML = resultsHTML;

  if (passedTests === currentExercise.testCases.length) {
    const isFirstTime = !studentProgress.completedExercises.includes(
      currentExercise.id
    );

    if (isFirstTime) {
      let earnedPoints = currentExercise.points;
      if (hintUsed) earnedPoints -= 5;

      studentProgress.completedExercises.push(currentExercise.id);
      studentProgress.totalPoints += earnedPoints;
      studentProgress.submissions[currentExercise.id] = {
        code: code,
        status: "AC",
        completedAt: firebase.firestore.FieldValue.serverTimestamp(),
        points: earnedPoints,
      };

      await db
        .collection("studentCodingProgress")
        .doc(currentUser.email)
        .set(studentProgress);

      outputDiv.innerHTML += `
        <div class="success-message">
          🎉 Təbriklər! Tapşırıq tamamlandı!<br>
          +${earnedPoints} xal qazandınız!
        </div>
      `;

      displayTopics();
      updateStats();
    } else {
      outputDiv.innerHTML += `
        <div style="text-align: center; color: #10b981; margin-top: 20px; font-size: 16px;">
          ✅ Bu tapşırıq artıq tamamlanmışdır
        </div>
      `;
    }
  }
}

// Kodu təmizlə
function clearCode() {
  if (confirm("Kodu təmizləmək istədiyinizə əminsiniz?")) {
    document.getElementById("codeInput").value = "";
    document.getElementById("output").innerHTML =
      '<div style="color: #999;">Kodu yoxlamaq üçün "Yoxla" düyməsinə basın</div>';
  }
}

// Statistikaları yenilə
function updateStats() {
  const completed = studentProgress.completedExercises.length;
  const total = allExercises.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById("completedCount").textContent = completed;
  document.getElementById("totalCount").textContent = total;
  document.getElementById("totalPoints").textContent =
    studentProgress.totalPoints;
  document.getElementById("progressFill").style.width = percentage + "%";
  document.getElementById("progressText").textContent = percentage + "%";
}
