// Importeer Firestore functies
import { doc, onSnapshot, getFirestore, setDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Globale Variabelen ---
let db;
let currentActiveIndex = -1;
let currentQuizStatus = "not_started";
let unsubscribeQuizState = null;
let unsubscribeAnswers = null;
let participantHasAnswered = false;
let score = 0;
let incorrectlyAnsweredQuestions = [];

// --- DOM Elementen ---
let waitingMessage, quizContent, questionDisplay, answerButtonsDiv, feedbackDiv, liveResultsDivParticipant;
let pCountA, pCountB, pCountC, pCountD, pTotalCount, pCorrectCount, pIncorrectCount;
let finalReportContainer, finalScoreP, finalIncorrectListDiv, finalCongratsP;

// --- Wacht tot DOM geladen is ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Deelnemer DOM geladen.");
    // Haal DOM elementen op
    waitingMessage = document.getElementById('waitingMessage');
    quizContent = document.getElementById('quizContent');
    questionDisplay = document.getElementById('questionDisplay');
    answerButtonsDiv = document.getElementById('answerButtons');
    feedbackDiv = document.getElementById('feedback');
    liveResultsDivParticipant = document.getElementById('liveResultsParticipant');
    pCountA = document.getElementById('pCountA'); pCountB = document.getElementById('pCountB');
    pCountC = document.getElementById('pCountC'); pCountD = document.getElementById('pCountD');
    pTotalCount = document.getElementById('pTotalCount'); pCorrectCount = document.getElementById('pCorrectCount');
    pIncorrectCount = document.getElementById('pIncorrectCount');
    finalReportContainer = document.getElementById('final-report-container');
    finalScoreP = document.getElementById('final-score');
    finalIncorrectListDiv = document.getElementById('final-incorrect-list');
    finalCongratsP = document.getElementById('final-congrats');
    if (!finalReportContainer) console.error("!!! final-report-container NIET GEVONDEN in HTML !!!");

    initializeDeelnemer();
});

// --- Initialisatie ---
function initializeDeelnemer() {
    if (typeof window.db !== 'undefined') {
        db = window.db; console.log("DB ref gevonden."); startListeningToQuizState();
    } else { console.log("Wachten op Firebase init..."); setTimeout(initializeDeelnemer, 1500); }
}

// --- Luister naar Quiz Status ---
function startListeningToQuizState() {
    if (unsubscribeQuizState) unsubscribeQuizState();
    if (!db) { console.error("DB niet beschikbaar voor listener."); return; }
    const quizStateRef = doc(db, "quizState", "currentState");
    console.log("Start luisteren naar quizState...");

    unsubscribeQuizState = onSnapshot(quizStateRef, (docSnap) => {
        console.log("--- Firestore Snapshot Ontvangen ---"); // Log elke snapshot
        let needsUpdate = false; // Start met false
        if (docSnap.exists()) {
            const data = docSnap.data();
            const newActiveIndex = data.activeQuestionIndex;
            const newQuizStatus = data.quizStatus;
            console.log("Ontvangen state:", { status: newQuizStatus, index: newActiveIndex });

            if (typeof quizData === 'undefined') { console.error("quizData niet beschikbaar!"); return; }

            if (newQuizStatus === 'not_started' && currentQuizStatus !== 'not_started') {
                 console.log("Resetting lokale data."); score = 0; incorrectlyAnsweredQuestions = [];
                 needsUpdate = true; // Status is veranderd
            }

            // Check of er echt iets veranderd is
            if (newActiveIndex !== currentActiveIndex) needsUpdate = true;
            if (newQuizStatus !== currentQuizStatus) needsUpdate = true;

            console.log(`Update nodig? Index (${currentActiveIndex} -> ${newActiveIndex}): ${newActiveIndex !== currentActiveIndex}, Status (${currentQuizStatus} -> ${newQuizStatus}): ${newQuizStatus !== currentQuizStatus}, Totaal: ${needsUpdate}`);

            // Update globale state ALTIJD
            currentActiveIndex = newActiveIndex;
            currentQuizStatus = newQuizStatus;

            // --- DEBUG: Roep UI update ALTIJD aan om logs te zien ---
            console.log("DEBUG: Roep updateParticipantUI altijd aan.");
            if (needsUpdate) { // Reset antwoord status alleen bij echte verandering
                 participantHasAnswered = false;
            }
            updateParticipantUI(); // Roep altijd aan
            // --- EINDE DEBUG ---

            /* // Oude code:
            if (needsUpdate) {
                 participantHasAnswered = false; // Reset voor nieuwe vraag
                 updateParticipantUI(); // Roep UI update functie aan
            } else {
                 console.log("Geen significante state verandering, geen UI update.");
            }
            */
        } else {
            console.log("Geen state doc! Wachten...");
            currentQuizStatus = "not_started"; currentActiveIndex = -1; score = 0; incorrectlyAnsweredQuestions = [];
            updateParticipantUI(); // Toon wachtscherm
        }
    }, (error) => {
         console.error("Fout bij luisteren naar quiz state:", error);
         waitingMessage.textContent = "Fout: Kon status niet ophalen.";
         quizContent.classList.add('hide'); liveResultsDivParticipant.classList.add('hide'); finalReportContainer.classList.add('hide'); waitingMessage.classList.remove('hide');
    });
}

// --- Update Deelnemer UI ---
function updateParticipantUI() {
    console.log("--- updateParticipantUI START --- Status:", currentQuizStatus, "Index:", currentActiveIndex); // Log aanroep

    // Verberg alles eerst...
    if(waitingMessage) waitingMessage.classList.add('hide');
    if(quizContent) quizContent.classList.add('hide');
    if(liveResultsDivParticipant) liveResultsDivParticipant.classList.add('hide');
    if(finalReportContainer) finalReportContainer.classList.add('hide'); else console.error("finalReportContainer is null/undefined in updateParticipantUI!");
    if (unsubscribeAnswers) { console.log("Antwoord listener gestopt."); unsubscribeAnswers(); unsubscribeAnswers = null; }

    // Bepaal wat te tonen
    if (currentQuizStatus === 'active' && currentActiveIndex >= 0 && currentActiveIndex < quizData.length) {
        console.log("UI Branch: Active Question");
        if(quizContent) quizContent.classList.remove('hide');
        if(liveResultsDivParticipant) liveResultsDivParticipant.classList.remove('hide');
        displayQuestion(currentActiveIndex);
        listenToAnswers(currentActiveIndex);

    } else if (currentQuizStatus === 'finished') {
        console.log("--- UI Branch: FINISHED ---"); // <<< ZEER BELANGRIJKE LOG
        if (finalReportContainer) {
             console.log("finalReportContainer gevonden. Probeer zichtbaar te maken...");
             finalReportContainer.classList.remove('hide'); // Probeer zichtbaar te maken
             console.log("classList na remove('hide'):", finalReportContainer.classList); // Check classes
             console.log("Probeer showFinalReport aan te roepen...");
             showFinalReport(); // Roep functie aan om rapport te vullen
             console.log("showFinalReport aangeroepen.");
        } else {
             console.error("!!! finalReportContainer NIET GEVONDEN in 'finished' block !!!");
             if(waitingMessage) {
                 waitingMessage.classList.remove('hide');
                 waitingMessage.textContent = "Quiz afgelopen, rapport niet beschikbaar (element error).";
             }
        }
    } else { // not_started of error
        console.log("UI Branch: Waiting / Not Started / Error");
        if(waitingMessage) {
             waitingMessage.classList.remove('hide');
             waitingMessage.textContent = "Wachten op de Quiz Master...";
        }
    }
     console.log("--- updateParticipantUI EINDE ---");
}


// --- Functie om een vraag te tonen ---
function displayQuestion(index) {
    if (!quizData || !quizData[index]) { console.error("Ongeldige vraag index:", index); return; }
    console.log("Vraag tonen:", index); const questionData = quizData[index];
    if (!questionDisplay || !answerButtonsDiv || !feedbackDiv) { console.error("Nodige elementen vraagweergave niet gevonden!"); return; }
    questionDisplay.textContent = questionData.question; answerButtonsDiv.innerHTML = ''; feedbackDiv.textContent = ''; clearLiveResults();
    const answersInOrder = questionData.answers; // Vaste volgorde
    answersInOrder.forEach(answer => {
        const button = document.createElement('button'); button.textContent = answer;
        button.onclick = () => handleAnswer(index, answer, questionData.correctAnswer); answerButtonsDiv.appendChild(button);
    });
}

// --- Functie om antwoord te verwerken ---
async function handleAnswer(questionIndex, selectedAnswer, correctAnswer) {
    if (participantHasAnswered) return; participantHasAnswered = true;
    const isCorrect = (selectedAnswer === correctAnswer);
    console.log(`handleAnswer: V.${questionIndex}, Gekozen: "${selectedAnswer}", Correct: ${isCorrect}`);
    if (!answerButtonsDiv || !feedbackDiv) { console.error("Knoppen of feedback div niet gevonden in handleAnswer"); return; }

    const buttons = answerButtonsDiv.querySelectorAll('button');
    buttons.forEach(button => {
        button.disabled = true;
        if (button.textContent === selectedAnswer) { button.classList.add('selected'); }
        if (button.textContent === correctAnswer) { button.classList.add('correct'); }
        if (button.textContent === selectedAnswer && !isCorrect) { button.classList.add('incorrect'); }
    });

    if (isCorrect) { score++; feedbackDiv.textContent = "Juist!"; feedbackDiv.style.color = "green"; }
    else {
        feedbackDiv.textContent = `Fout! Het juiste antwoord was: ${correctAnswer}`; feedbackDiv.style.color = "red";
        if (quizData && quizData[questionIndex]) { incorrectlyAnsweredQuestions.push({ questionText: quizData[questionIndex].question, userAnswer: selectedAnswer, correctAnswer: correctAnswer }); console.log("Fout antwoord toegevoegd:", incorrectlyAnsweredQuestions); }
        else { console.error("Kon vraagdata niet vinden:", questionIndex); }
    }
    console.log("handleAnswer: Lokale score nu:", score);

    // Stuur naar Firestore
    try {
        if (!db) throw new Error("DB niet beschikbaar.");
        const originalQuestionData = quizData[questionIndex]; const answerOptions = originalQuestionData.answers;
        const chosenOptionIndex = answerOptions.indexOf(selectedAnswer); let fieldToIncrement = ["A", "B", "C", "D"][chosenOptionIndex];
        if (fieldToIncrement) {
             const answerDocRef = doc(db, "answers", String(questionIndex)); console.log("handleAnswer: Doc Ref:", answerDocRef.path);
             const updateData = { lastAnswerTimestamp: serverTimestamp() };
             updateData[fieldToIncrement] = increment(1); updateData["total"] = increment(1);
             updateData[isCorrect ? "correctCount" : "incorrectCount"] = increment(1);
             console.log("handleAnswer: Data:", updateData);
             await setDoc(answerDocRef, updateData, { merge: true });
             console.log(`handleAnswer: Antwoord V.${questionIndex} succesvol opgeslagen.`);
        } else { throw new Error("Kon antwoord niet mappen."); }
    } catch (error) {
        console.error("!!! handleAnswer: FOUT bij opslaan antwoord:", error);
        if (feedbackDiv) { feedbackDiv.textContent += " (Opslagfout!)"; feedbackDiv.style.color = "orange"; }
    }
}


// --- Functies Live Resultaten ---
function listenToAnswers(questionIndex) { if (unsubscribeAnswers) { unsubscribeAnswers(); unsubscribeAnswers = null; } clearLiveResults(); if (!db) return; const answerDocRef = doc(db, "answers", String(questionIndex)); unsubscribeAnswers = onSnapshot(answerDocRef, (docSnap) => { if (docSnap.exists()) { updateLiveResults(docSnap.data()); } else { clearLiveResults(); } }, (error) => { console.error(`Fout luisteren antwoorden V.${questionIndex}:`, error); }); }
function updateLiveResults(data) { if(!pCountA) return; pCountA.textContent = data.A || 0; pCountB.textContent = data.B || 0; pCountC.textContent = data.C || 0; pCountD.textContent = data.D || 0; pTotalCount.textContent = data.total || 0; pCorrectCount.textContent = data.correctCount || 0; pIncorrectCount.textContent = data.incorrectCount || 0; }
function clearLiveResults() { if(!pCountA) return; pCountA.textContent = 0; pCountB.textContent = 0; pCountC.textContent = 0; pCountD.textContent = 0; pTotalCount.textContent = 0; pCorrectCount.textContent = 0; pIncorrectCount.textContent = 0; }

// --- Functie: Toon Eindrapport ---
function showFinalReport() {
     console.log("!!! showFinalReport FUNCTIE START !!!"); // <<< EXTRA LOG
     console.log("Score:", score, "Aantal Fouten:", incorrectlyAnsweredQuestions.length);
     if (!finalReportContainer || !finalScoreP || !finalIncorrectListDiv || !finalCongratsP) { console.error("Elementen eindrapport niet gevonden in showFinalReport!"); return; }
     const totalQuizQuestions = (typeof quizData !== 'undefined' && Array.isArray(quizData)) ? quizData.length : 50;
     finalScoreP.textContent = `Jouw Eindscore: ${score} / ${totalQuizQuestions}`;
     finalIncorrectListDiv.innerHTML = ''; finalCongratsP.textContent = '';

     if (incorrectlyAnsweredQuestions.length === 0) {
          console.log("Geen foute antwoorden te tonen."); finalCongratsP.textContent = "Geweldig! Alles correct!"; finalIncorrectListDiv.innerHTML = '<p><i>Geen foute antwoorden.</i></p>';
     } else {
          console.log("Foute antwoorden tonen:", incorrectlyAnsweredQuestions); finalCongratsP.textContent = "";
          incorrectlyAnsweredQuestions.forEach(item => {
               const div = document.createElement('div'); const qText = document.createElement('p'); const qTextStrong = document.createElement('strong'); qTextStrong.textContent = item.questionText; qText.appendChild(qTextStrong);
               const userAnswerText = document.createElement('p'); const userAnsI = document.createElement('i'); userAnsI.textContent = item.userAnswer; userAnswerText.appendChild(document.createTextNode("  Jouw antwoord: ")); userAnswerText.appendChild(userAnsI);
               const correctAnswerText = document.createElement('p'); const correctAnsStrong = document.createElement('strong'); correctAnsStrong.textContent = item.correctAnswer; correctAnswerText.appendChild(document.createTextNode("  Juiste antwoord: ")); correctAnswerText.appendChild(correctAnsStrong);
               div.appendChild(qText); div.appendChild(userAnswerText); div.appendChild(correctAnswerText); finalIncorrectListDiv.appendChild(div);
          });
     }
      console.log("Rapport HTML gevuld. Probeer te scrollen."); // <<< EXTRA LOG
      finalReportContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      console.log("--- showFinalReport EINDE ---"); // <<< EXTRA LOG
}
// --- EINDE Functie: Toon Eindrapport ---

// Hulpfunctie shuffleArray (niet meer nodig)
/* function shuffleArray(array) { ... } */