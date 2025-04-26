// Importeer Firestore functies
import { doc, onSnapshot, getFirestore, updateDoc, setDoc, getDoc, collection, writeBatch, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Globale variabelen
let currentQuizState = { activeQuestionIndex: -1, quizStatus: "not_started" };
let totalQuestions = 0;
let db;
let unsubscribeAnswers = null; // Listener voor antwoorden
let quizStateRef; // Referentie naar quiz state document
let initialized = false; // Voorkom dubbele initialisatie/listeners

// DOM Elementen (globaal voor toegang in functies)
let currentQuestionIndexSpan, questionDisplayDiv, optionsDisplayDiv, liveResultsDiv, prevQuestionBtn, nextQuestionBtn, resetQuizBtn;
// Nieuwe elementen voor analyse
let analyzeQuizBtn, analysisResultsDiv, analysisSummaryDiv, analysisIncorrectListDiv, analysisSeparator;


// --- Knop Actie Functies ---
async function handleNextQuestion() {
     console.log("--- handleNextQuestion START ---");
     console.log("Beschikbaar? db:", !!db, "quizStateRef:", !!quizStateRef, "initialized:", initialized);
     if (!db || !quizStateRef || !initialized) { console.log("Gestopt: refs/init missen."); return; }
     console.log("Huidige LOKALE state:", currentQuizState);

    const currentIndex = currentQuizState.activeQuestionIndex;
    const nextIndex = currentIndex + 1;

    if (currentQuizState.quizStatus === 'finished') { console.log("Quiz al afgelopen."); return; }

    if (currentIndex === totalQuestions - 1) { // Laatste vraag was actief (index 49)
        console.log("Laatste vraag was actief, afronden...");
        try {
            await updateDoc(quizStateRef, { quizStatus: "finished" }); console.log("Status: finished.");
        } catch (error) { console.error("Fout bij afronden:", error); alert("Fout bij afronden."); }
    } else if (nextIndex < totalQuestions) { // Ga naar volgende vraag (0 t/m 49)
        try {
            console.log(`Naar vraag ${nextIndex}`);
            await updateDoc(quizStateRef, { activeQuestionIndex: nextIndex, quizStatus: "active" });
        } catch (error) { console.error("Fout volgende vraag:", error); alert("Fout: kon niet naar volgende."); }
    } else { console.warn("Poging voorbij laatste vraag?"); try { await updateDoc(quizStateRef, { quizStatus: "finished" }); } catch(error) {/* ignore */} }
}

async function handlePrevQuestion() {
     if (!db || !quizStateRef || !initialized) return;
    const prevIndex = currentQuizState.activeQuestionIndex - 1;
    if (prevIndex >= -1) {
        try {
            console.log(`Naar vraag ${prevIndex}`);
            await updateDoc(quizStateRef, { activeQuestionIndex: prevIndex, quizStatus: (prevIndex === -1) ? "not_started" : "active" });
        } catch (error) { console.error("Fout vorige vraag:", error); alert("Fout: kon niet naar vorige."); }
    }
}

// --- Reset Functie (VERSIE DIE ANTWOORDEN NIET VERWIJDERT) ---

// --- Reset Functie (MET ANTWOORDEN VERWIJDEREN) ---
async function handleResetQuiz(confirmReset = true) {
     if (!db) { console.error("DB niet beschikbaar voor reset."); return; }
     const localQuizStateRef = quizStateRef || doc(db, "quizState", "currentState");

    if (!confirmReset || confirm("Weet je zeker dat je de quiz wilt resetten? Alle antwoorden worden definitief verwijderd!")) { // Bevestigingstekst aangepast
        try {
            console.log("Master: Resetting quiz...");
            if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; }

            // 1. Reset quizState document
            await setDoc(localQuizStateRef, { activeQuestionIndex: -1, quizStatus: "not_started" });
            console.log("quizState gereset.");

            // --- START HERSTELDE CODE (Antwoorden WEL Verwijderen) ---
            // 2. Verwijder alle antwoord documenten NU WEL
             console.log("Verwijderen oude antwoorden...");
             const answersCollectionRef = collection(db, "answers");
             const querySnapshot = await getDocs(answersCollectionRef);
             if (!querySnapshot.empty) {
                 const batch = writeBatch(db);
                 querySnapshot.forEach((doc) => { batch.delete(doc.ref); });
                 await batch.commit(); // Voer verwijderingen uit
                 console.log(`${querySnapshot.size} oude antwoorden verwijderd.`);
             } else { console.log("Geen oude antwoorden gevonden om te verwijderen."); }
            // --- EINDE HERSTELDE CODE ---

             clearLiveResults(); // Wis live resultaten display

             // Verberg Analyse
             if (analysisResultsDiv && analysisSeparator && analyzeQuizBtn) {
                 analysisResultsDiv.classList.add('hide');
                 analysisSeparator.classList.add('hide');
                 analyzeQuizBtn.classList.add('hide');
                 analyzeQuizBtn.textContent = "Toon Eindanalyse"; analyzeQuizBtn.disabled = false;
             }

             // Update UI direct
             currentQuizState = { activeQuestionIndex: -1, quizStatus: "not_started" };
             if (initialized) { updateMasterUI(); }

             if (confirmReset) { alert("Quiz succesvol gereset! (Antwoorden ook verwijderd)"); }

        } catch (error) {
            console.error("Fout bij resetten quiz:", error); // Log de error!
            if (confirmReset) { alert("Fout bij resetten: " + error.message); }
        }
    }
}
// --- EINDE Reset Functie ---

// --- EINDE Reset Functie ---

async function handleAnalyzeQuiz() {
    console.log("--- handleAnalyzeQuiz START ---"); // Duidelijke start log
    // Basis checks
    if (!db || !initialized || !analyzeQuizBtn || !analysisResultsDiv || !analysisSummaryDiv || !analysisIncorrectListDiv) {
         console.error("Analyse Start Fout: Elementen of DB missen."); return;
    }
    // UI aanpassen voor laden
    analyzeQuizBtn.disabled = true; analyzeQuizBtn.textContent = "Analyseren...";
    analysisResultsDiv.classList.remove('hide');
    analysisSummaryDiv.innerHTML = '<i>Antwoorden ophalen uit Firestore...</i>'; analysisIncorrectListDiv.innerHTML = '';
    console.log("UI gezet op laden...");

    let totalCorrect = 0; let totalIncorrect = 0; let totalAnswered = 0;
    const incorrectCountsPerQuestion = [];

    try {
        console.log("Poging tot ophalen 'answers' collectie...");
        const answersCollectionRef = collection(db, "answers");
        const querySnapshot = await getDocs(answersCollectionRef);
        console.log(`Snapshot ontvangen. Aantal documenten: ${querySnapshot.size}`); // Log aantal

        if (querySnapshot.empty) {
             console.log("Geen antwoorddata gevonden in Firestore.");
             throw new Error("Geen antwoorddata gevonden om te analyseren.");
        }

        console.log("Start verwerken documenten...");
        querySnapshot.forEach((docSnap) => {
            const questionIndex = parseInt(docSnap.id, 10);
            const answerData = docSnap.data();
             console.log(`Verwerk document ${docSnap.id}:`, answerData); // Log elk document

            // Controleer of index een geldig getal is
            if (isNaN(questionIndex)) {
                 console.warn(`Ongeldige document ID gevonden in answers: ${docSnap.id}`);
                 return; // Sla dit document over
            }

            const correct = answerData.correctCount || 0;
            const incorrect = answerData.incorrectCount || 0;
            const total = answerData.total || 0;

            totalCorrect += correct; totalIncorrect += incorrect; totalAnswered += total;

            if (incorrect > 0) {
                 let questionText = `Vraag ${questionIndex + 1} (tekst niet gevonden)`; // Default
                 if (typeof quizData !== 'undefined' && quizData[questionIndex]) {
                     questionText = quizData[questionIndex].question;
                 } else {
                      console.warn(`Vraagdata niet gevonden voor index ${questionIndex}`);
                 }
                 incorrectCountsPerQuestion.push({ questionIndex, questionText, incorrectCount: incorrect, totalAnswers: total });
            }
        });
        console.log("Documenten verwerkt. Totaal beantwoord:", totalAnswered);

        // Sorteren
        incorrectCountsPerQuestion.sort((a, b) => b.incorrectCount - a.incorrectCount);
        console.log("Foutenlijst gesorteerd.");

        // Percentages berekenen
        const percentageCorrect = totalAnswered > 0 ? ((totalCorrect / totalAnswered) * 100).toFixed(1) : 0;
        const percentageIncorrect = totalAnswered > 0 ? ((totalIncorrect / totalAnswered) * 100).toFixed(1) : 0;
        console.log("Percentages berekend.");

        // Samenvatting tonen
        analysisSummaryDiv.innerHTML = `
            Totaal aantal gegeven antwoorden: <strong>${totalAnswered}</strong><br>
            Totaal Juist: <strong style="color: green;">${totalCorrect}</strong> (${percentageCorrect}%)<br>
            Totaal Fout: <strong style="color: red;">${totalIncorrect}</strong> (${percentageIncorrect}%)
        `;
        console.log("Samenvatting getoond.");

        // Foutenlijst tonen
        displayErrorAnalysis(incorrectCountsPerQuestion);
        console.log("Foutenlijst getoond via displayErrorAnalysis.");

        analyzeQuizBtn.textContent = "Analyse Getoond"; // Klaar

    } catch (error) {
        console.error("!!! FOUT TIJDENS ANALYSE:", error); // Log de fout HIER
        analysisSummaryDiv.innerHTML = `<p style="color: red;">Fout bij laden analyse: ${error.message}</p>`;
        analysisIncorrectListDiv.innerHTML = '';
        analyzeQuizBtn.textContent = "Analyse Mislukt";
        analyzeQuizBtn.disabled = false; // Maak weer klikbaar
    }
}

function displayErrorAnalysis(results) { /* ... (Functie blijft hetzelfde als vorige keer) ... */
     if (!analysisIncorrectListDiv) return; if (results.length === 0) { analysisIncorrectListDiv.innerHTML = '<p><i>Geen vragen fout beantwoord!</i></p>'; return; }
     let html = '<ol style="padding-left: 20px;">';
     results.forEach(item => { const percIncorrect = item.totalAnswers > 0 ? ((item.incorrectCount / item.totalAnswers) * 100).toFixed(0) : 0; html += `<li style="margin-bottom: 8px;">(${item.incorrectCount} fout / ${item.totalAnswers} totaal = ${percIncorrect}%)<br><strong>Vraag ${item.questionIndex + 1}:</strong> ${item.questionText}</li>`; });
     html += '</ol>'; analysisIncorrectListDiv.innerHTML = html;
 }
// --- EINDE Eind Analyse Functies ---


// --- Functie om UI bij te werken ---
function updateMasterUI() { /* ... (Functie blijft hetzelfde als vorige keer, met de correctie voor nextButton.disabled) ... */
    if (!initialized) return; console.log("updateMasterUI met state:", currentQuizState);
    if (!currentQuestionIndexSpan || !questionDisplayDiv || !optionsDisplayDiv || !prevQuestionBtn || !nextQuestionBtn || !analyzeQuizBtn || !analysisSeparator || !analysisResultsDiv) { console.error("UI elementen missen!"); return; }
    const activeIndex = currentQuizState.activeQuestionIndex; const status = currentQuizState.quizStatus;
    if (status === 'finished') { currentQuestionIndexSpan.textContent = "Afgelopen"; } else if (activeIndex === -1) { currentQuestionIndexSpan.textContent = "Niet Gestart"; } else { currentQuestionIndexSpan.textContent = `${activeIndex + 1} / ${totalQuestions}`; }
    prevQuestionBtn.disabled = (activeIndex <= 0 || status === 'finished');
    nextQuestionBtn.disabled = (status === 'finished'); // Alleen disabled als finished
    if (activeIndex === -1 && status !== 'finished') { nextQuestionBtn.textContent = "Start Quiz"; } else if (status === 'finished' || activeIndex === totalQuestions - 1) { nextQuestionBtn.textContent = "Quiz Afgelopen"; } else { nextQuestionBtn.textContent = "Volgende Vraag"; }
    if (activeIndex >= 0 && activeIndex < totalQuestions && status === 'active') {
        if (!quizData || !quizData[activeIndex]) { questionDisplayDiv.textContent = "Fout: Vraag data."; optionsDisplayDiv.innerHTML = ''; clearLiveResults(); return; }
        questionDisplayDiv.textContent = quizData[activeIndex].question; optionsDisplayDiv.innerHTML = '<ul>' + quizData[activeIndex].answers.map((ans, i) => `<li>${String.fromCharCode(65 + i)}: ${ans} ${ans === quizData[activeIndex].correctAnswer ? '<strong>(Juist)</strong>' : ''}</li>`).join('') + '</ul>'; listenToAnswers(activeIndex);
    } else { if (status === 'finished') { questionDisplayDiv.textContent = "De quiz is afgelopen."; } else { questionDisplayDiv.textContent = "Quiz nog niet gestart."; } optionsDisplayDiv.innerHTML = ''; clearLiveResults(); if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; } }
    if (status === 'finished') { analyzeQuizBtn.classList.remove('hide'); analysisSeparator.classList.remove('hide'); } else { analyzeQuizBtn.classList.add('hide'); analysisResultsDiv.classList.add('hide'); analysisSeparator.classList.add('hide'); }
}

// --- Functies Live Resultaten ---
function listenToAnswers(questionIndex) { /* ... (ongewijzigd) ... */ if (!db) return; if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; } clearLiveResults(); const answerDocRef = doc(db, "answers", String(questionIndex)); console.log(`Master: Luisteren V.${questionIndex}`); unsubscribeAnswers = onSnapshot(answerDocRef, (docSnap) => { if (docSnap.exists()) { updateLiveResults(docSnap.data()); } else { clearLiveResults(); } }, (error) => { console.error(`Fout luisteren V.${questionIndex}:`, error); }); }
function updateLiveResults(data) { /* ... (ongewijzigd) ... */ if (!initialized) return; document.getElementById('countA').textContent = data.A || 0; document.getElementById('countB').textContent = data.B || 0; document.getElementById('countC').textContent = data.C || 0; document.getElementById('countD').textContent = data.D || 0; document.getElementById('totalCount').textContent = data.total || 0; document.getElementById('correctCount').textContent = data.correctCount || 0; document.getElementById('incorrectCount').textContent = data.incorrectCount || 0; }
function clearLiveResults() { /* ... (ongewijzigd) ... */ if (!initialized) return; document.getElementById('countA').textContent = 0; document.getElementById('countB').textContent = 0; document.getElementById('countC').textContent = 0; document.getElementById('countD').textContent = 0; document.getElementById('totalCount').textContent = 0; document.getElementById('correctCount').textContent = 0; document.getElementById('incorrectCount').textContent = 0; }

// --- Functie om te luisteren naar quizState ---
function startListeningToQuizState() { /* ... (ongewijzigd) ... */ if (!db) { console.error("DB niet beschikbaar."); return;} quizStateRef = doc(db, "quizState", "currentState"); onSnapshot(quizStateRef, (docSnap) => { if (docSnap.exists()) { currentQuizState = docSnap.data(); console.log("Master: State update:", currentQuizState); } else { console.log("Master: Geen state doc! Resetting."); currentQuizState = { activeQuestionIndex: -1, quizStatus: "not_started" }; handleResetQuiz(false); } if(initialized) { updateMasterUI(); } }, (error) => { console.error("Master: Fout luisteren state:", error); questionDisplayDiv.textContent = "Fout status."; currentQuizState = { activeQuestionIndex: -1, quizStatus: "error" }; if(initialized) { updateMasterUI(); } }); }

// --- Initialisatie functie ---
function initializeMaster() { /* ... (ongewijzigd) ... */ console.log("Master DOM geladen."); currentQuestionIndexSpan = document.getElementById('currentQuestionIndex'); questionDisplayDiv = document.getElementById('questionDisplay'); optionsDisplayDiv = document.getElementById('optionsDisplay'); liveResultsDiv = document.getElementById('liveResults'); prevQuestionBtn = document.getElementById('prevQuestionBtn'); nextQuestionBtn = document.getElementById('nextQuestionBtn'); resetQuizBtn = document.getElementById('resetQuizBtn'); analyzeQuizBtn = document.getElementById('analyzeQuizBtn'); analysisResultsDiv = document.getElementById('analysisResults'); analysisSummaryDiv = document.getElementById('analysis-summary'); analysisIncorrectListDiv = document.getElementById('analysis-incorrect-list'); analysisSeparator = document.getElementById('analysis-separator'); if (nextQuestionBtn) { nextQuestionBtn.addEventListener('click', handleNextQuestion); } else { console.error("Knop nextQuestionBtn niet gevonden!"); } if (prevQuestionBtn) { prevQuestionBtn.addEventListener('click', handlePrevQuestion); } else { console.error("Knop prevQuestionBtn niet gevonden!"); } if (resetQuizBtn) { resetQuizBtn.addEventListener('click', handleResetQuiz); } else { console.error("Knop resetQuizBtn niet gevonden!"); } if (analyzeQuizBtn) { analyzeQuizBtn.addEventListener('click', handleAnalyzeQuiz); } else { console.error("Knop analyzeQuizBtn niet gevonden!"); } if (typeof quizData === 'undefined' || !Array.isArray(quizData) || quizData.length === 0) { console.error("quizData niet beschikbaar!"); if(questionDisplayDiv) questionDisplayDiv.textContent = "Fout: Vragenlijst."; return; } totalQuestions = quizData.length; console.log(`Master: ${totalQuestions} vragen geladen.`); function connectToFirestore() { if (typeof window.db !== 'undefined') { db = window.db; console.log("Firestore DB ref gevonden."); initialized = true; startListeningToQuizState(); } else { console.log("Wachten op Firebase init..."); setTimeout(connectToFirestore, 500); } } connectToFirestore(); }

// --- Wacht tot DOM geladen is en start dan initialisatie ---
document.addEventListener('DOMContentLoaded', initializeMaster);