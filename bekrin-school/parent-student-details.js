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

let currentParent = null;
let students = [];
let currentStudent = null;

// Səhifə yükləndikdə
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Uşaq təfərrüatları səhifəsi yüklənir...');

    // İstifadəçi yoxlaması
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            alert('Giriş etməlisiniz!');
            window.location.href = 'index.html';
            return;
        }

        console.log('İstifadəçi:', user.email);

        // Valideyn yoxlaması
        const userDoc = await db.collection('users').doc(user.email).get();
        
        if (!userDoc.exists || userDoc.data().role !== 'parent') {
            alert('Bu səhifəyə yalnız valideynlər daxil ola bilər!');
            window.location.href = 'index.html';
            return;
        }

        currentParent = { email: user.email, ...userDoc.data() };
        console.log('Valideyn təsdiqləndi:', currentParent.fullName);

        // Uşaqları yüklə
        await loadStudents();
    });
});

// Uşaqları yüklə
async function loadStudents() {
    try {
        console.log('Uşaqlar yüklənir...');

        const studentsSnapshot = await db.collection('students')
            .where('parentEmail', '==', currentParent.email)
            .where('status', '==', 'active')
            .orderBy('fullName')
            .get();

        students = [];
        studentsSnapshot.forEach(doc => {
            students.push({ id: doc.id, ...doc.data() });
        });

        console.log('Tapılan uşaq sayı:', students.length);

        if (students.length === 0) {
            document.getElementById('loadingScreen').innerHTML = 
                '<h2 style="color: white;">⚠️ Qeydiyyatlı övladınız tapılmadı</h2>' +
                '<a href="parent-dashboard.html" class="back-btn" style="margin-top: 20px;">Ana Səhifəyə Qayıt</a>';
            return;
        }

        // Dropdown-u doldur
        const select = document.getElementById('studentSelect');
        select.innerHTML = '<option value="">Övlad seçin...</option>';
        
        students.forEach(student => {
            const option = document.createElement('option');
            option.value = student.email;
            option.textContent = student.fullName;
            select.appendChild(option);
        });

        // Event listener
        select.addEventListener('change', (e) => {
            const selectedEmail = e.target.value;
            if (selectedEmail) {
                loadStudentDetails(selectedEmail);
            } else {
                document.getElementById('studentContent').style.display = 'none';
            }
        });

        // Loading gizlət
        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';

        // URL-dən studentEmail varsa, avtomatik seç
        const urlParams = new URLSearchParams(window.location.search);
        const studentEmail = urlParams.get('studentEmail');
        if (studentEmail) {
            select.value = studentEmail;
            loadStudentDetails(studentEmail);
        }

    } catch (error) {
        console.error('Uşaqlar yüklənərkən xəta:', error);
        alert('Xəta: ' + error.message);
    }
}

// Uşaq təfərrüatlarını yüklə
async function loadStudentDetails(studentEmail) {
    try {
        console.log('Uşaq təfərrüatları yüklənir:', studentEmail);

        currentStudent = students.find(s => s.email === studentEmail);
        if (!currentStudent) {
            throw new Error('Uşaq tapılmadı');
        }

        // Profil məlumatlarını göstər
        displayStudentProfile();

        // Davamiyyət yüklə
        await loadAttendance();

        // Ödənişlər yüklə
        await loadPayments();

        // Test nəticələri yüklə
        await loadTests();

        // Content göstər
        document.getElementById('studentContent').style.display = 'block';

    } catch (error) {
        console.error('Təfərrüatlar yüklənərkən xəta:', error);
        alert('Xəta: ' + error.message);
    }
}

// Profil məlumatlarını göstər
function displayStudentProfile() {
    document.getElementById('studentAvatar').textContent = currentStudent.fullName.charAt(0).toUpperCase();
    document.getElementById('studentName').textContent = currentStudent.fullName;
    document.getElementById('studentEmail').textContent = currentStudent.email;
    document.getElementById('studentClass').textContent = currentStudent.class || '--';
    document.getElementById('studentBalance').textContent = (currentStudent.balance || 0) + ' AZN';
}

// Davamiyyət yüklə
async function loadAttendance() {
    try {
        console.log('Davamiyyət yüklənir...');

        const attendanceSnapshot = await db.collection('attendance')
            .where('studentEmail', '==', currentStudent.email)
            .orderBy('date', 'desc')
            .limit(50)
            .get();

        const attendanceRecords = [];
        attendanceSnapshot.forEach(doc => {
            attendanceRecords.push({ id: doc.id, ...doc.data() });
        });

        console.log('Davamiyyət qeydləri:', attendanceRecords.length);

        // Statistika hesabla
        let presentCount = 0, absentCount = 0, lateCount = 0;

        attendanceRecords.forEach(record => {
            if (record.status === 'present') presentCount++;
            else if (record.status === 'absent') absentCount++;
            else if (record.status === 'late') lateCount++;
        });

        const total = attendanceRecords.length;
        const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

        // Statistika göstər
        document.getElementById('attendancePercentage').textContent = percentage + '%';
        document.getElementById('presentCount').textContent = presentCount;
        document.getElementById('absentCount').textContent = absentCount;
        document.getElementById('lateCount').textContent = lateCount;

        // Siyahını göstər
        const list = document.getElementById('attendanceList');
        list.innerHTML = '';

        if (attendanceRecords.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Davamiyyət qeydi yoxdur</p></div>';
            return;
        }

        attendanceRecords.forEach(record => {
            const date = record.date?.toDate();
            const dateStr = date ? date.toLocaleDateString('az-AZ') : '--';
            
            let statusText = '';
            let statusClass = '';
            
            if (record.status === 'present') {
                statusText = 'İştirak';
                statusClass = 'present';
            } else if (record.status === 'absent') {
                statusText = 'Qeyri-ixtiyari';
                statusClass = 'absent';
            } else if (record.status === 'late') {
                statusText = 'Gecikmə';
                statusClass = 'late';
            }

            list.innerHTML += `
                <div class="attendance-record">
                    <div>
                        <div class="date">${dateStr}</div>
                        <div class="group">${record.groupName || '--'}</div>
                    </div>
                    <span class="attendance-badge ${statusClass}">${statusText}</span>
                </div>
            `;
        });

    } catch (error) {
        console.error('Davamiyyət yüklənərkən xəta:', error);
        document.getElementById('attendanceList').innerHTML = 
            '<div class="empty-state"><div class="icon">⚠️</div><p>Xəta baş verdi</p></div>';
    }
}

// Ödənişlər yüklə
async function loadPayments() {
    try {
        console.log('Ödənişlər yüklənir...');

        const paymentsSnapshot = await db.collection('payments')
            .where('studentEmail', '==', currentStudent.email)
            .where('status', '==', 'paid')
            .orderBy('date', 'desc')
            .get();

        const payments = [];
        paymentsSnapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        console.log('Ödəniş qeydləri:', payments.length);

        // Statistika hesabla
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        
        const now = new Date();
        const thisMonthPayments = payments.filter(p => {
            const paymentDate = p.date?.toDate();
            return paymentDate && 
                   paymentDate.getMonth() === now.getMonth() && 
                   paymentDate.getFullYear() === now.getFullYear();
        });
        const thisMonthPaid = thisMonthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

        // Statistika göstər
        document.getElementById('paymentCount').textContent = payments.length;
        document.getElementById('totalPaid').textContent = totalPaid + ' AZN';
        document.getElementById('thisMonthPaid').textContent = thisMonthPaid + ' AZN';

        // Siyahını göstər
        const list = document.getElementById('paymentList');
        list.innerHTML = '';

        if (payments.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="icon">💰</div><p>Ödəniş qeydi yoxdur</p></div>';
            return;
        }

        payments.forEach(payment => {
            const date = payment.date?.toDate();
            const dateStr = date ? date.toLocaleDateString('az-AZ') : '--';
            
            let methodText = '';
            if (payment.paymentMethod === 'cash') methodText = 'Nağd';
            else if (payment.paymentMethod === 'card') methodText = 'Kart';
            else if (payment.paymentMethod === 'bank') methodText = 'Bank';

            list.innerHTML += `
                <div class="payment-record">
                    <div class="payment-info">
                        <div class="date">${dateStr}</div>
                        <div class="month">📅 ${payment.month || '--'}</div>
                        <div class="payment-method">${methodText}</div>
                    </div>
                    <div class="payment-amount">+${payment.amount} AZN</div>
                </div>
            `;
        });

    } catch (error) {
        console.error('Ödənişlər yüklənərkən xəta:', error);
        document.getElementById('paymentList').innerHTML = 
            '<div class="empty-state"><div class="icon">⚠️</div><p>Xəta baş verdi</p></div>';
    }
}

// Test nəticələri yüklə
async function loadTests() {
    try {
        console.log('Test nəticələri yüklənir...');

        const testsSnapshot = await db.collection('studentTests')
            .where('studentEmail', '==', currentStudent.email)
            .where('status', '==', 'graded')
            .orderBy('submittedAt', 'desc')
            .get();

        const tests = [];
        testsSnapshot.forEach(doc => {
            tests.push({ id: doc.id, ...doc.data() });
        });

        console.log('Test nəticələri:', tests.length);

        // Statistika hesabla
        const completedTests = tests.length;
        const scores = tests.map(t => t.finalScore || 0);
        const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
        const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
        const averageScore = scores.length > 0 ? 
            Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : 0;

        // Statistika göstər
        document.getElementById('testCount').textContent = completedTests;
        document.getElementById('averageScore').textContent = averageScore;
        document.getElementById('completedTests').textContent = completedTests;
        document.getElementById('highestScore').textContent = highestScore;
        document.getElementById('lowestScore').textContent = lowestScore;

        // Siyahını göstər
        const list = document.getElementById('testList');
        list.innerHTML = '';

        if (tests.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="icon">📝</div><p>Test nəticəsi yoxdur</p></div>';
            return;
        }

        tests.forEach(test => {
            const date = test.submittedAt?.toDate();
            const dateStr = date ? date.toLocaleDateString('az-AZ') : '--';
            
            const badgeClass = test.testType === 'quiz' ? 'quiz' : 'sinaq';
            const badgeText = test.testType === 'quiz' ? 'Quiz' : 'Sınaq';

            list.innerHTML += `
                <div class="test-record">
                    <div class="test-header">
                        <div class="test-name">${test.testName}</div>
                        <span class="test-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="test-stats">
                        <div class="test-stat">
                            <div class="label">Bal</div>
                            <div class="value">${Math.round(test.finalScore || 0)}</div>
                        </div>
                        <div class="test-stat">
                            <div class="label">Faiz</div>
                            <div class="value">${Math.round(test.percentage || 0)}%</div>
                        </div>
                        <div class="test-stat">
                            <div class="label">Rank</div>
                            <div class="value">${test.rank || '--'}/${test.totalStudents || '--'}</div>
                        </div>
                    </div>
                    <div class="test-date">📅 ${dateStr}</div>
                </div>
            `;
        });

    } catch (error) {
        console.error('Test nəticələri yüklənərkən xəta:', error);
        document.getElementById('testList').innerHTML = 
            '<div class="empty-state"><div class="icon">⚠️</div><p>Xəta baş verdi</p></div>';
    }
}

// Tab keçidi
function switchTab(tabName) {
    // Bütün tabları gizlət
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Bütün düymələri deaktiv et
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Seçilən tabı göstər
    document.getElementById(tabName + 'Tab').classList.add('active');
    event.target.classList.add('active');
}
