// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753"
};


// Firebase-i başlat
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentGroupId = '';
let currentGroupName = '';
let currentStudents = [];
let selectedStudentForMove = '';

// Səhifə yükləndikdə
window.onload = function() {
    // URL-dən groupId və groupName al
    const urlParams = new URLSearchParams(window.location.search);
    currentGroupId = urlParams.get('id');
    currentGroupName = decodeURIComponent(urlParams.get('name') || 'Qrup');

    if (!currentGroupId) {
        alert('Qrup ID tapılmadı!');
        window.location.href = 'teacher-groups.html';
        return;
    }

    document.getElementById('groupTitle').textContent = currentGroupName;

    auth.onAuthStateChanged(user => {
        if (user) {
            checkTeacherAccess(user.email);
        } else {
            window.location.href = 'index.html';
        }
    });
};

// Müəllim səlahiyyətini yoxla
async function checkTeacherAccess(email) {
    try {
        const userDoc = await db.collection('users').doc(email).get();
        
        if (!userDoc.exists || userDoc.data().role !== 'teacher') {
            alert('Bu səhifəyə giriş icazəniz yoxdur!');
            window.location.href = 'index.html';
            return;
        }

        loadStudents();
    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta baş verdi: ' + error.message);
    }
}

// Şagirdləri yüklə
async function loadStudents() {
    try {
        const groupDoc = await db.collection('groups').doc(currentGroupId).get();
        
        if (!groupDoc.exists) {
            alert('Qrup tapılmadı!');
            window.location.href = 'teacher-groups.html';
            return;
        }

        const groupData = groupDoc.data();
        currentStudents = groupData.students || [];

        const loadingMessage = document.getElementById('loadingMessage');
        const studentList = document.getElementById('studentList');
        const noStudents = document.getElementById('noStudents');

        loadingMessage.style.display = 'none';

        if (currentStudents.length === 0) {
            noStudents.style.display = 'block';
            return;
        }

        studentList.innerHTML = '';
        studentList.style.display = 'flex';

        // Hər şagird üçün məlumat al
        for (const studentEmail of currentStudents) {
            const studentSnapshot = await db.collection('students')
                .where('email', '==', studentEmail)
                .get();

            if (!studentSnapshot.empty) {
                const studentData = studentSnapshot.docs[0].data();
                const studentName = studentData.fullName || studentEmail;

                const item = document.createElement('div');
                item.className = 'student-item';
                item.innerHTML = `
                    <div class="student-info">
                        <div class="student-name">${studentName}</div>
                        <div class="student-email">${studentEmail}</div>
                    </div>
                    <div class="student-actions">
                        <button class="btn-action btn-move" onclick="showMoveStudentModal('${studentEmail}', '${studentName}')">
                            ↔️ Köçür
                        </button>
                        <button class="btn-action btn-remove" onclick="removeStudent('${studentEmail}', '${studentName}')">
                            🗑️ Sil
                        </button>
                    </div>
                `;
                studentList.appendChild(item);
            }
        }

    } catch (error) {
        console.error("Şagirdlər yüklənərkən xəta:", error);
        document.getElementById('loadingMessage').textContent = 'Xəta: ' + error.message;
    }
}

// Şagird əlavə et modal-ı aç
async function showAddStudentModal() {
    try {
        // Bütün aktiv şagirdləri al
        const studentsSnapshot = await db.collection('students')
            .where('status', '==', 'active')
            .get();

        // Bu qrupda olmayan şagirdləri göstər
        const availableStudents = [];
        studentsSnapshot.forEach(doc => {
            const studentData = doc.data();
            if (!currentStudents.includes(studentData.email)) {
                availableStudents.push(studentData);
            }
        });

        const selectList = document.getElementById('studentSelectList');
        selectList.innerHTML = '';

        if (availableStudents.length === 0) {
            selectList.innerHTML = '<div class="no-students">Əlavə ediləcək şagird yoxdur</div>';
        } else {
            availableStudents.forEach(student => {
                const item = document.createElement('div');
                item.className = 'student-select-item';
                item.onclick = () => addStudentToGroup(student.email, student.fullName);
                item.innerHTML = `
                    <div style="font-weight: bold;">${student.fullName}</div>
                    <div style="font-size: 14px; color: #666;">${student.email}</div>
                `;
                selectList.appendChild(item);
            });
        }

        document.getElementById('addStudentModal').style.display = 'flex';

    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta: ' + error.message);
    }
}

// Modal-ı bağla
function closeAddStudentModal() {
    document.getElementById('addStudentModal').style.display = 'none';
}

// Şagird qrupa əlavə et
async function addStudentToGroup(studentEmail, studentName) {
    try {
        await db.collection('groups').doc(currentGroupId).update({
            students: firebase.firestore.FieldValue.arrayUnion(studentEmail)
        });

        alert(`✅ ${studentName} qrupa əlavə edildi!`);
        closeAddStudentModal();
        loadStudents();

    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta: ' + error.message);
    }
}

// Şagird sil
async function removeStudent(studentEmail, studentName) {
    if (!confirm(`${studentName} şagirdini qrupdan silmək istədiyinizdən əminsiniz?`)) {
        return;
    }

    try {
        await db.collection('groups').doc(currentGroupId).update({
            students: firebase.firestore.FieldValue.arrayRemove(studentEmail)
        });

        alert(`✅ ${studentName} qrupdan silindi!`);
        loadStudents();

    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta: ' + error.message);
    }
}

// Şagird köçür modal-ı aç
async function showMoveStudentModal(studentEmail, studentName) {
    selectedStudentForMove = studentEmail;

    try {
        // Digər aktiv qrupları al
        const groupsSnapshot = await db.collection('groups')
            .where('active', '==', true)
            .get();

        const selectList = document.getElementById('groupSelectList');
        selectList.innerHTML = '';

        let hasOtherGroups = false;

        groupsSnapshot.forEach(doc => {
            if (doc.id !== currentGroupId) {
                hasOtherGroups = true;
                const groupData = doc.data();
                const item = document.createElement('div');
                item.className = 'student-select-item';
                item.onclick = () => moveStudentToGroup(doc.id, groupData.name, studentName);
                item.innerHTML = `
                    <div style="font-weight: bold;">${groupData.name}</div>
                    <div style="font-size: 14px; color: #666;">Şagird sayı: ${(groupData.students || []).length}</div>
                `;
                selectList.appendChild(item);
            }
        });

        if (!hasOtherGroups) {
            selectList.innerHTML = '<div class="no-students">Başqa qrup yoxdur</div>';
        }

        document.getElementById('moveStudentModal').style.display = 'flex';

    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta: ' + error.message);
    }
}

// Modal-ı bağla
function closeMoveStudentModal() {
    document.getElementById('moveStudentModal').style.display = 'none';
    selectedStudentForMove = '';
}

// Şagird başqa qrupa köçür
async function moveStudentToGroup(targetGroupId, targetGroupName, studentName) {
    try {
        // Köhnə qrupdan sil
        await db.collection('groups').doc(currentGroupId).update({
            students: firebase.firestore.FieldValue.arrayRemove(selectedStudentForMove)
        });

        // Yeni qrupa əlavə et
        await db.collection('groups').doc(targetGroupId).update({
            students: firebase.firestore.FieldValue.arrayUnion(selectedStudentForMove)
        });

        alert(`✅ ${studentName} "${targetGroupName}" qrupuna köçürüldü!`);
        closeMoveStudentModal();
        loadStudents();

    } catch (error) {
        console.error("Xəta:", error);
        alert('Xəta: ' + error.message);
    }
}

// Modal xaricə klik edəndə bağla
window.onclick = function(event) {
    const addModal = document.getElementById('addStudentModal');
    const moveModal = document.getElementById('moveStudentModal');
    
    if (event.target === addModal) {
        closeAddStudentModal();
    }
    if (event.target === moveModal) {
        closeMoveStudentModal();
    }
}
