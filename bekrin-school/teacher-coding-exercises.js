// Firebase konfiqurasiyası və imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let allExercises = [];
let currentEditId = null;
let testCaseCounter = 0;

// Auth yoxlaması
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.email));
    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    // Məsələləri yüklə
    await loadExercises();
  } catch (error) {
    console.error("Auth xətası:", error);
    alert("Xəta baş verdi");
    window.location.href = "index.html";
  }
});

// Məsələləri yüklə
async function loadExercises() {
  try {
    const q = query(collection(db, "codingExercises"), orderBy("order", "asc"));
    const snapshot = await getDocs(q);

    allExercises = [];
    snapshot.forEach((doc) => {
      allExercises.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    displayExercises(allExercises);
  } catch (error) {
    console.error("Yükləmə xətası:", error);
    const container = document.getElementById("exercisesContainer");
    container.innerHTML = `
            <div class="empty-state">
                <h2>❌ Xəta</h2>
                <p>Məsələlər yüklənə bilmədi: ${error.message}</p>
            </div>
        `;
  }
}

// Məsələləri göstər
function displayExercises(exercises) {
  const container = document.getElementById("exercisesContainer");

  if (exercises.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <h2>📝 Məsələ Yoxdur</h2>
                <p>Hələ kodlaşdırma məsələsi əlavə edilməyib.</p>
                <button class="btn btn-add" onclick="openModal()">
                    ➕ İlk Məsələni Əlavə Et
                </button>
            </div>
        `;
    return;
  }

  container.innerHTML = exercises
    .map((exercise) => {
      const difficultyClass = `difficulty-${exercise.difficulty.toLowerCase()}`;
      return `
            <div class="exercise-card">
                <div class="exercise-header">
                    <div>
                        <span class="exercise-topic">${
                          exercise.topic || "Ümumi"
                        }</span>
                        <div class="exercise-title">${exercise.title}</div>
                    </div>
                    <span class="difficulty-badge ${difficultyClass}">
                        ${exercise.difficulty}
                    </span>
                </div>
                
                <div class="exercise-description">
                    ${exercise.description || "Təsvir yoxdur"}
                </div>
                
                <div class="exercise-meta">
                    <div class="meta-item">
                        <strong>Xal:</strong> ${exercise.points || 0}
                    </div>
                    <div class="meta-item">
                        <strong>Test sayı:</strong> ${
                          exercise.testCases?.length || 0
                        }
                    </div>
                    ${
                      exercise.order
                        ? `
                        <div class="meta-item">
                            <strong>Sıra:</strong> ${exercise.order}
                        </div>
                    `
                        : ""
                    }
                </div>
                
                <div class="exercise-actions">
                    <button class="action-btn btn-view" onclick="viewExercise('${
                      exercise.id
                    }')">
                        👁️ Bax
                    </button>
                    <button class="action-btn btn-edit" onclick="editExercise('${
                      exercise.id
                    }')">
                        ✏️ Redaktə
                    </button>
                    <button class="action-btn btn-delete" onclick="deleteExercise('${
                      exercise.id
                    }', '${exercise.title}')">
                        🗑️ Sil
                    </button>
                </div>
            </div>
        `;
    })
    .join("");
}

// Filter məsələləri
window.filterExercises = function () {
  const topicFilter = document.getElementById("topicFilter").value;
  const difficultyFilter = document.getElementById("difficultyFilter").value;

  let filtered = allExercises;

  if (topicFilter) {
    filtered = filtered.filter((ex) => ex.topic === topicFilter);
  }

  if (difficultyFilter) {
    filtered = filtered.filter((ex) => ex.difficulty === difficultyFilter);
  }

  displayExercises(filtered);
};

// Modal aç
window.openModal = function () {
  currentEditId = null;
  document.getElementById("modalTitle").textContent =
    "🚀 Yeni Kodlaşdırma Məsələsi";
  document.getElementById("exerciseForm").reset();
  document.getElementById("testCasesContainer").innerHTML = "";
  testCaseCounter = 0;

  // İlk test case əlavə et
  addTestCase();

  document.getElementById("exerciseModal").style.display = "block";
  document.body.style.overflow = "hidden";
};

// Modal bağla
window.closeModal = function () {
  document.getElementById("exerciseModal").style.display = "none";
  document.body.style.overflow = "auto";
  currentEditId = null;
};

// Test case əlavə et
window.addTestCase = function () {
  testCaseCounter++;
  const container = document.getElementById("testCasesContainer");
  const testCase = document.createElement("div");
  testCase.className = "test-case";
  testCase.id = `testCase${testCaseCounter}`;
  testCase.innerHTML = `
        <div class="test-case-header">
            <strong>Test Case ${testCaseCounter}</strong>
            <button type="button" class="remove-test-btn" onclick="removeTestCase('testCase${testCaseCounter}')">
                ❌ Sil
            </button>
        </div>
        <input type="text" placeholder="Input (məs: 5 və ya 5\\n10)" class="test-input" required>
        <input type="text" placeholder="Gözlənilən nəticə (məs: 10)" class="test-expected" required>
        <input type="text" placeholder="Açıqlama (istəyə bağlı)" class="test-description">
    `;
  container.appendChild(testCase);
};

// Test case sil
window.removeTestCase = function (id) {
  const element = document.getElementById(id);
  if (element) {
    element.remove();
  }
};

// Məsələni yadda saxla
window.saveExercise = async function () {
  const form = document.getElementById("exerciseForm");

  if (!form.checkValidity()) {
    alert("⚠️ Zəhmət olmasa bütün məcburi sahələri doldurun");
    form.reportValidity();
    return;
  }

  // Test case-ləri yığ
  const testCases = [];
  const testCaseElements = document.querySelectorAll(".test-case");

  if (testCaseElements.length === 0) {
    alert("⚠️ Ən azı bir test case əlavə edin");
    return;
  }

  let hasEmptyTest = false;
  testCaseElements.forEach((tc) => {
    const input = tc.querySelector(".test-input").value.trim();
    const expected = tc.querySelector(".test-expected").value.trim();
    const description = tc.querySelector(".test-description").value.trim();

    if (!input || !expected) {
      hasEmptyTest = true;
      return;
    }

    testCases.push({ input, expected, description });
  });

  if (hasEmptyTest) {
    alert(
      "⚠️ Bütün test case-lərin input və gözlənilən nəticə sahələrini doldurun"
    );
    return;
  }

  if (testCases.length === 0) {
    alert("⚠️ Ən azı bir tam doldurulmuş test case əlavə edin");
    return;
  }

  try {
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Yadda saxlanılır...";

    const exerciseData = {
      topic: document.getElementById("topic").value,
      title: document.getElementById("title").value,
      description: document.getElementById("description").value,
      starterCode: document.getElementById("starterCode").value,
      testCases: testCases,
      difficulty: document.getElementById("difficulty").value,
      points: parseInt(document.getElementById("points").value),
      order: parseInt(document.getElementById("order").value) || 999,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email,
    };

    if (currentEditId) {
      // Redaktə
      await updateDoc(doc(db, "codingExercises", currentEditId), exerciseData);
      alert("✅ Məsələ uğurla yeniləndi!");
    } else {
      // Yeni əlavə
      exerciseData.createdAt = serverTimestamp();
      exerciseData.createdBy = auth.currentUser.email;
      await addDoc(collection(db, "codingExercises"), exerciseData);
      alert("✅ Məsələ uğurla əlavə edildi!");
    }

    closeModal();
    await loadExercises();
  } catch (error) {
    console.error("Yadda saxlama xətası:", error);
    alert("❌ Xəta baş verdi: " + error.message);
  } finally {
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = false;
    saveBtn.textContent = "✅ Yadda Saxla";
  }
};

// Məsələyə bax
window.viewExercise = function (id) {
  const exercise = allExercises.find((ex) => ex.id === id);
  if (!exercise) return;

  const testCasesHTML = exercise.testCases
    .map(
      (tc, i) => `
        <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; margin-bottom: 10px;">
            <strong>Test ${i + 1}:</strong><br>
            <strong>Input:</strong> <code>${tc.input}</code><br>
            <strong>Gözlənilən:</strong> <code>${tc.expected}</code><br>
            ${
              tc.description
                ? `<strong>Açıqlama:</strong> ${tc.description}`
                : ""
            }
        </div>
    `
    )
    .join("");

  const content = `
        <div style="max-width: 800px; background: white; padding: 30px; border-radius: 15px; max-height: 80vh; overflow-y: auto;">
            <h2 style="color: #667eea; margin-bottom: 10px;">${exercise.title}</h2>
            <div style="margin-bottom: 20px;">
                <span style="background: #e3f2fd; color: #1976D2; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold;">
                    ${exercise.topic}
                </span>
                <span style="background: #d4edda; color: #155724; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-left: 10px;">
                    ${exercise.difficulty}
                </span>
                <span style="background: #fff3cd; color: #856404; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-left: 10px;">
                    ${exercise.points} xal
                </span>
            </div>
            
            <h3 style="margin-top: 25px; color: #333;">📝 Təsvir:</h3>
            <p style="line-height: 1.6; color: #666;">${exercise.description}</p>
            
            <h3 style="margin-top: 25px; color: #333;">💻 Başlanğıc Kodu:</h3>
            <pre style="background: #f5f5f5; padding: 15px; border-radius: 8px; overflow-x: auto;"><code>${exercise.starterCode}</code></pre>
            
            <h3 style="margin-top: 25px; color: #333;">🧪 Test Case-lər:</h3>
            ${testCasesHTML}
            
            <button onclick="closeViewModal()" style="margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
                Bağla
            </button>
        </div>
    `;

  const viewModal = document.createElement("div");
  viewModal.id = "viewModal";
  viewModal.style.cssText =
    "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 20px; overflow-y: auto;";
  viewModal.innerHTML = content;
  document.body.appendChild(viewModal);
  document.body.style.overflow = "hidden";
};

window.closeViewModal = function () {
  const modal = document.getElementById("viewModal");
  if (modal) {
    modal.remove();
    document.body.style.overflow = "auto";
  }
};

// Məsələni redaktə et
window.editExercise = async function (id) {
  const exercise = allExercises.find((ex) => ex.id === id);
  if (!exercise) return;

  currentEditId = id;

  // Modal başlığını dəyiş
  document.getElementById("modalTitle").textContent = "✏️ Məsələni Redaktə Et";

  // Formu doldur
  document.getElementById("topic").value = exercise.topic || "";
  document.getElementById("title").value = exercise.title || "";
  document.getElementById("description").value = exercise.description || "";
  document.getElementById("starterCode").value = exercise.starterCode || "";
  document.getElementById("difficulty").value = exercise.difficulty || "Asan";
  document.getElementById("points").value = exercise.points || 10;
  document.getElementById("order").value = exercise.order || "";

  // Test case-ləri doldur
  document.getElementById("testCasesContainer").innerHTML = "";
  testCaseCounter = 0;

  if (exercise.testCases && exercise.testCases.length > 0) {
    exercise.testCases.forEach((tc) => {
      testCaseCounter++;
      const container = document.getElementById("testCasesContainer");
      const testCase = document.createElement("div");
      testCase.className = "test-case";
      testCase.id = `testCase${testCaseCounter}`;
      testCase.innerHTML = `
                <div class="test-case-header">
                    <strong>Test Case ${testCaseCounter}</strong>
                    <button type="button" class="remove-test-btn" onclick="removeTestCase('testCase${testCaseCounter}')">
                        ❌ Sil
                    </button>
                </div>
                <input type="text" placeholder="Input" class="test-input" value="${
                  tc.input || ""
                }" required>
                <input type="text" placeholder="Gözlənilən nəticə" class="test-expected" value="${
                  tc.expected || ""
                }" required>
                <input type="text" placeholder="Açıqlama" class="test-description" value="${
                  tc.description || ""
                }">
            `;
      container.appendChild(testCase);
    });
  } else {
    addTestCase();
  }

  // Modalı aç
  document.getElementById("exerciseModal").style.display = "block";
  document.body.style.overflow = "hidden";
};

// Məsələni sil
window.deleteExercise = async function (id, title) {
  if (
    !confirm(
      `"${title}" məsələsini silmək istədiyinizə əminsiniz?\n\nBu əməliyyat geri qaytarıla bilməz!`
    )
  ) {
    return;
  }

  try {
    await deleteDoc(doc(db, "codingExercises", id));
    alert("✅ Məsələ silindi");
    await loadExercises();
  } catch (error) {
    console.error("Silmə xətası:", error);
    alert("❌ Xəta: " + error.message);
  }
};

// Modal kənarda kliklədikdə bağla
window.onclick = function (event) {
  const modal = document.getElementById("exerciseModal");
  if (event.target === modal) {
    closeModal();
  }

  const viewModal = document.getElementById("viewModal");
  if (event.target === viewModal) {
    closeViewModal();
  }
};

// ESC düyməsi ilə bağla
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeModal();
    closeViewModal();
  }
});
