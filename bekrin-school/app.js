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

// Elementlər
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorMessage = document.getElementById("errorMessage");
const loadingText = document.getElementById("loadingText");

// Səhifə yükləndikdə - əgər artıq giriş edibsə
auth.onAuthStateChanged(async (user) => {
  if (user) {
    console.log("İstifadəçi artıq daxil olub:", user.email);
    await redirectUserByRole(user);
  }
});

// Login form submit
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  // Validasiya
  if (!email || !password) {
    showError("Email və şifrə daxil edilməlidir!");
    return;
  }

  // Loading state
  setLoading(true);
  hideError();

  try {
    console.log("Giriş cəhdi:", email);

    // Firebase Authentication ilə giriş
    const userCredential = await auth.signInWithEmailAndPassword(
      email,
      password
    );
    const user = userCredential.user;

    console.log("✅ Firebase Authentication uğurlu:", user.email);

    // Rol əsasında yönləndirmə
    await redirectUserByRole(user);
  } catch (error) {
    console.error("❌ Giriş xətası:", error);

    let errorText = "Giriş zamanı xəta baş verdi!";

    if (error.code === "auth/user-not-found") {
      errorText = "❌ Bu email ilə istifadəçi tapılmadı!";
    } else if (error.code === "auth/wrong-password") {
      errorText = "❌ Şifrə yanlışdır!";
    } else if (error.code === "auth/invalid-email") {
      errorText = "❌ Email formatı düzgün deyil!";
    } else if (error.code === "auth/too-many-requests") {
      errorText = "⚠️ Çoxlu uğursuz cəhd! Bir az gözləyin.";
    } else {
      errorText = "❌ " + error.message;
    }

    showError(errorText);
    setLoading(false);
  }
});

// Rol əsasında yönləndirmə
async function redirectUserByRole(user) {
  try {
    console.log("Rol yoxlanılır:", user.email);

    // Firestore-dan istifadəçi məlumatını al
    const userDoc = await db.collection("users").doc(user.email).get();

    if (!userDoc.exists) {
      throw new Error(
        "İstifadəçi məlumatları tapılmadı! Zəhmət olmasa admin ilə əlaqə saxlayın."
      );
    }

    const userData = userDoc.data();
    const role = userData.role;

    console.log("✅ Rol təsdiqləndi:", role);

    // Rol əsasında yönləndirmə
    switch (role) {
      case "teacher":
        console.log("➡️ Müəllim panelinə yönləndirilir...");
        window.location.href = "teacher-dashboard.html";
        break;

      case "student":
        console.log("➡️ Şagird panelinə yönləndirilir...");
        window.location.href = "student-dashboard.html";
        break;

      case "parent":
        console.log("➡️ Valideyn panelinə yönləndirilir...");
        window.location.href = "parent-dashboard.html"; // ✅ DÜZƏLDİLDİ
        break;

      case "assistant":
        console.log("➡️ Assistent panelinə yönləndirilir...");
        window.location.href = "assistant-dashboard.html";
        break;

      default:
        throw new Error(
          "Naməlum rol: " + role + ". Zəhmət olmasa admin ilə əlaqə saxlayın."
        );
    }
  } catch (error) {
    console.error("❌ Rol yoxlaması xətası:", error);

    // Çıxış et
    await auth.signOut();

    showError(error.message);
    setLoading(false);
  }
}

// Error göstər
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
}

// Error gizlət
function hideError() {
  errorMessage.style.display = "none";
}

// Loading state
function setLoading(isLoading) {
  if (isLoading) {
    loginBtn.disabled = true;
    loginBtn.textContent = "⏳ Yoxlanılır...";
    loadingText.style.display = "block";
  } else {
    loginBtn.disabled = false;
    loginBtn.textContent = "🚀 Daxil ol";
    loadingText.style.display = "none";
  }
}

// Enter key ilə submit
passwordInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    loginForm.dispatchEvent(new Event("submit"));
  }
});
