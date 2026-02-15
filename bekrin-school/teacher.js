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

// Səhifə yükləndikdə
document.addEventListener("DOMContentLoaded", function () {
  console.log("Müəllim paneli yüklənir...");

  // Auth yoxlama
  auth.onAuthStateChanged((user) => {
    if (!user) {
      console.log("İstifadəçi daxil olmayıb");
      window.location.href = "index.html";
      return;
    }

    console.log("İstifadəçi daxil olub:", user.email);

    // Müəllim rolunu yoxla
    db.collection("users")
      .doc(user.email)
      .get()
      .then((doc) => {
        if (!doc.exists) {
          console.error("İstifadəçi məlumatları tapılmadı");
          alert("İstifadəçi məlumatları tapılmadı!");
          auth.signOut();
          return;
        }

        const userData = doc.data();
        console.log("İstifadəçi məlumatları:", userData);

        if (userData.role !== "teacher") {
          console.error("Bu istifadəçi müəllim deyil:", userData.role);
          alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
          auth.signOut();
          return;
        }

        console.log("Müəllim təsdiqləndi!");

        // Müəllim adını göstər
        const welcomeText = document.getElementById("welcomeText");
        if (welcomeText) {
          welcomeText.textContent = `Xoş gəlmisiniz, ${
            userData.fullName || user.email
          }!`;
        }
      })
      .catch((error) => {
        console.error("Firestore xətası:", error);
        alert("Xəta baş verdi: " + error.message);
      });
  });

  // Çıxış düyməsi
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      console.log("Çıxış edilir...");
      auth
        .signOut()
        .then(() => {
          window.location.href = "index.html";
        })
        .catch((error) => {
          console.error("Çıxış xətası:", error);
          alert("Çıxış xətası: " + error.message);
        });
    });
  }
});
