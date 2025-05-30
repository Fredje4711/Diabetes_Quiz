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
            await updateDoc(quizStateRef, {
                activeQuestionIndex: prevIndex,
                quizStatus: (prevIndex === -1) ? "not_started" : "active"
            });
        } catch (error) { console.error("Fout vorige vraag:", error); alert("Fout: kon niet naar vorige."); }
    }
}

// --- Reset Functie (MET ANTWOORDEN VERWIJDEREN) ---
async function handleResetQuiz(confirmReset = true) {
     if (!db) { console.error("DB niet beschikbaar voor reset."); return; }
     const localQuizStateRef = quizStateRef || doc(db, "quizState", "currentState");

    if (!confirmReset || confirm("Weet je zeker dat je de quiz wilt resetten? Alle antwoorden worden definitief verwijderd!")) {
        try {
            console.log("Master: Resetting quiz...");
            if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; }

            // 1. Reset quizState document
            await setDoc(localQuizStateRef, { activeQuestionIndex: -1, quizStatus: "not_started" });
            console.log("quizState gereset.");

            // 2. Verwijder alle antwoord documenten NU WEL
             console.log("Verwijderen oude antwoorden...");
             const answersCollectionRef = collection(db, "answers");
             const querySnapshot = await getDocs(answersCollectionRef);
             if (!querySnapshot.empty) {
                 const batch = writeBatch(db);
                 querySnapshot.forEach((doc) => { batch.delete(doc.ref); });
                 await batch.commit();
                 console.log(`${querySnapshot.size} oude antwoorden verwijderd.`);
             } else { console.log("Geen oude antwoorden gevonden om te verwijderen."); }

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
            console.error("Fout bij resetten quiz:", error);
            if (confirmReset) { alert("Fout bij resetten: " + error.message); }
        }
    }
}
// --- EINDE Reset Functie ---

async function handleAnalyzeQuiz() { /* ... (Functie blijft hetzelfde als vorige keer) ... */
    console.log("Starten eindanalyse..."); if (!db || !initialized || !analyzeQuizBtn) { return; }
    analyzeQuizBtn.disabled = true; analyzeQuizBtn.textContent = "Analyseren...";
    analysisResultsDiv.classList.remove('hide'); analysisSummaryDiv.innerHTML = '<i>Antwoorden ophalen...</i>'; analysisIncorrectListDiv.innerHTML = '';
    let totalCorrect = 0, totalIncorrect = 0, totalAnswered = 0; const incorrectCountsPerQuestion = [];
    try {
        const answersCollectionRef = collection(db, "answers"); const querySnapshot = await getDocs(answersCollectionRef);
        if (querySnapshot.empty) { throw new Error("Geen antwoorddata."); }
        querySnapshot.forEach((docSnap) => {
            const questionIndex = parseInt(docSnap.id, 10); if(isNaN(questionIndex)) return; const answerData = docSnap.data(); const correct = answerData.correctCount || 0; const incorrect = answerData.incorrectCount || 0; const total = answerData.total || 0;
            totalCorrect += correct; totalIncorrect += incorrect; totalAnswered += total;
            if (incorrect > 0 && typeof quizData !== 'undefined' && quizData[questionIndex]) { incorrectCountsPerQuestion.push({ questionIndex, questionText: quizData[questionIndex].question, incorrectCount: incorrect, totalAnswers: total }); }
            else if (incorrect > 0) { console.warn(`Vraagdata niet gevonden index ${questionIndex}`); incorrectCountsPerQuestion.push({ questionIndex, questionText: `Vraag ${questionIndex + 1}`, incorrectCount: incorrect, totalAnswers: total }); }
        });
        incorrectCountsPerQuestion.sort((a, b) => b.incorrectCount - a.incorrectCount);
        const percCorrect = totalAnswered > 0 ? ((totalCorrect / totalAnswered) * 100).toFixed(1) : 0; const percIncorrect = totalAnswered > 0 ? ((totalIncorrect / totalAnswered) * 100).toFixed(1) : 0;
        analysisSummaryDiv.innerHTML = `Totaal gegeven antwoorden: <strong>${totalAnswered}</strong><br>Totaal Juist: <strong style="color: green;">${totalCorrect}</strong> (${percCorrect}%)<br>Totaal Fout: <strong style="color: red;">${totalIncorrect}</strong> (${percIncorrect}%)`;
        displayErrorAnalysis(incorrectCountsPerQuestion); analyzeQuizBtn.textContent = "Analyse Getoond";
    } catch (error) { console.error("Fout analyseren:", error); analysisSummaryDiv.innerHTML = `<p style="color: red;">Fout: ${error.message}</p>`; analysisIncorrectListDiv.innerHTML = ''; analyzeQuizBtn.textContent = "Analyse Mislukt"; analyzeQuizBtn.disabled = false; }
 }

function displayErrorAnalysis(results) { /* ... (Functie blijft hetzelfde als vorige keer met "X deelnemer(s)") ... */
     if (!analysisIncorrectListDiv) return; const topN = 10; const topResults = results.slice(0, topN);
     if (topResults.length === 0) { analysisIncorrectListDiv.innerHTML = '<p><i>Geen vragen fout beantwoord!</i></p>'; return; }
     const listTitle = document.querySelector('#analysisResults h3'); if(listTitle) listTitle.textContent = `Top ${topResults.length} Meest Fout Beantwoorde Vragen:`;
     let html = '<ol style="padding-left: 20px; list-style-position: outside;">';
     topResults.forEach(item => { const percIncorrect = item.totalAnswers > 0 ? ((item.incorrectCount / item.totalAnswers) * 100).toFixed(0) : 0; html += `<li style="margin-bottom: 10px; line-height: 1.4;"><span style="font-weight: bold; font-size: 1.1em; color: #dc3545;">${item.incorrectCount} deelnemer${item.incorrectCount !== 1 ? 's' : ''}</span> <span style="font-size: 0.9em; color: #6c757d;">(${percIncorrect}%)</span><br><strong>Vraag ${item.questionIndex + 1}:</strong> ${item.questionText}</li>`; });
     html += '</ol>'; if (results.length > topN) { html += `<p style="font-size: 0.9em; text-align: center; margin-top: 15px;"><i>(... en ${results.length - topN} andere vragen met foute antwoorden)</i></p>`; }
     analysisIncorrectListDiv.innerHTML = html; console.log("Foutenanalyse lijst HTML bijgewerkt.");
}
// --- EINDE Eind Analyse Functies ---


// --- Functie om UI bij te werken ---
function updateMasterUI() { /* ... (Functie blijft hetzelfde als vorige keer, met de correcte knop-disable logica) ... */
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

// --- Functies voor Live Resultaten ---
function listenToAnswers(questionIndex) { /* ... (ongewijzigd) ... */ if (!db) return; if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; } clearLiveResults(); const answerDocRef = doc(db, "answers", String(questionIndex)); console.log(`Master: Luisteren V.${questionIndex}`); unsubscribeAnswers = onSnapshot(answerDocRef, (docSnap) => { if (docSnap.exists()) { updateLiveResults(docSnap.data()); } else { clearLiveResults(); } }, (error) => { console.error(`Fout luisteren V.${questionIndex}:`, error); }); }
function updateLiveResults(data) { /* ... (ongewijzigd) ... */ if (!initialized) return; document.getElementById('countA').textContent = data.A || 0; document.getElementById('countB').textContent = data.B || 0; document.getElementById('countC').textContent = data.C || 0; document.getElementById('countD').textContent = data.D || 0; document.getElementById('totalCount').textContent = data.total || 0; document.getElementById('correctCount').textContent = data.correctCount || 0; document.getElementById('incorrectCount').textContent = data.incorrectCount || 0; }
function clearLiveResults() { /* ... (ongewijzigd) ... */ if (!initialized) return; document.getElementById('countA').textContent = 0; document.getElementById('countB').textContent = 0; document.getElementById('countC').textContent = 0; document.getElementById('countD').textContent = 0; document.getElementById('totalCount').textContent = 0; document.getElementById('correctCount').textContent = 0; document.getElementById('incorrectCount').textContent = 0; }


// --- Functie om te luisteren naar quizState ---
function startListeningToQuizState() { /* ... (ongewijzigd) ... */ if (!db) { console.error("DB niet beschikbaar."); return;} quizStateRef = doc(db, "quizState", "currentState"); onSnapshot(quizStateRef, (docSnap) => { if (docSnap.exists()) { currentQuizState = docSnap.data(); console.log("Master: State update:", currentQuizState); } else { console.log("Master: Geen state doc! Resetting."); currentQuizState = { activeQuestionIndex: -1, quizStatus: "not_started" }; handleResetQuiz(false); } if(initialized) { updateMasterUI(); } }, (error) => { console.error("Master: Fout luisteren state:", error); questionDisplayDiv.textContent = "Fout status."; currentQuizState = { activeQuestionIndex: -1, quizStatus: "error" }; if(initialized) { updateMasterUI(); } }); }

// --- Initialisatie functie ---
function initializeMaster() {
    console.log("Master DOM geladen, start initialisatie.");

    // --- START Simpele Wachtwoord Check ---
    const correctMasterPassword = "DiabetesQuiz2025!"; // <<< VERANDER DIT WACHTWOORD!
    let enteredPassword = null;
    let attempts = 0;
    const maxAttempts = 3; // Maximaal 3 pogingen

    while (enteredPassword !== correctMasterPassword && attempts < maxAttempts) {
        attempts++;
        enteredPassword = prompt(`Voer het master wachtwoord in (Poging ${attempts}/${maxAttempts}):`);
        if (enteredPassword === null) { // Gebruiker klikte op Annuleren
            alert("Login geannuleerd. Toegang geweigerd.");
            document.body.innerHTML = '<h1 style="color:red; text-align:center; margin-top: 50px;">Toegang Geannuleerd</h1>';
            return; // Stop de initialisatie
        }
    }

    if (enteredPassword !== correctMasterPassword) {
        alert(`Incorrect wachtwoord na ${maxAttempts} pogingen. Toegang geweigerd.`);
        document.body.innerHTML = '<h1 style="color:red; text-align:center; margin-top: 50px;">Toegang Geweigerd</h1>';
        return; // Stop de initialisatie
    }
    console.log("Wachtwoord correct, initialisatie gaat verder.");
    // --- EINDE Simpele Wachtwoord Check ---


    // Selecteer DOM elementen
    currentQuestionIndexSpan = document.getElementById('currentQuestionIndex');
    questionDisplayDiv = document.getElementById('questionDisplay');
    optionsDisplayDiv = document.getElementById('optionsDisplay');
    liveResultsDiv = document.getElementById('liveResults');
    prevQuestionBtn = document.getElementById('prevQuestionBtn');
    nextQuestionBtn = document.getElementById('nextQuestionBtn');
    resetQuizBtn = document.getElementById('resetQuizBtn');
    analyzeQuizBtn = document.getElementById('analyzeQuizBtn');
    analysisResultsDiv = document.getElementById('analysisResults');
    analysisSummaryDiv = document.getElementById('analysis-summary');
    analysisIncorrectListDiv = document.getElementById('analysis-incorrect-list');
    analysisSeparator = document.getElementById('analysis-separator');

    // Koppel Knop Acties DIRECT
    if (nextQuestionBtn) { nextQuestionBtn.addEventListener('click', handleNextQuestion); } else { console.error("Knop nextQuestionBtn niet gevonden!"); }
    if (prevQuestionBtn) { prevQuestionBtn.addEventListener('click', handlePrevQuestion); } else { console.error("Knop prevQuestionBtn niet gevonden!"); }
    if (resetQuizBtn) { resetQuizBtn.addEventListener('click', handleResetQuiz); } else { console.error("Knop resetQuizBtn niet gevonden!"); }
    if (analyzeQuizBtn) { analyzeQuizBtn.addEventListener('click', handleAnalyzeQuiz); } else { console.error("Knop analyzeQuizBtn niet gevonden!"); }

    // Controleer quizData EERST
    if (typeof quizData === 'undefined' || !Array.isArray(quizData) || quizData.length === 0) {
        console.error("quizData is niet beschikbaar!");
        if(questionDisplayDiv) questionDisplayDiv.textContent = "Fout: Vragenlijst niet geladen.";
        return; // Stop verdere initialisatie
    }
    totalQuestions = quizData.length;
    console.log(`Master: ${totalQuestions} vragen geladen.`);

    // Probeer Firestore DB te krijgen en listener te starten
    function connectToFirestore() {
        if (typeof window.db !== 'undefined') {
            db = window.db;
            console.log("Firestore DB referentie gevonden voor Master.");
            initialized = true; // Zet flag dat alles klaar is
            startListeningToQuizState(); // Start nu pas met luisteren
        } else {
            console.log("Wachten op Firebase initialisatie...");
            setTimeout(connectToFirestore, 500); // Probeer iets sneller opnieuw
        }
    }
    connectToFirestore(); // Start het verbinden

} // Einde initializeMaster


// --- Wacht tot DOM geladen is en start dan initialisatie ---
document.addEventListener('DOMContentLoaded', initializeMaster);