// The quit question, "Stop Marasi too?" (quit_question.go): Go asks it
// when quitting while the app owns a run, and waits for AnswerQuitQuestion.

/** Go's event carrying the question. */
export const QUIT_QUESTION_EVENT = "quit-question";

/** The When quitting setting's choices, as Settings → Connection shows them. */
export const WHEN_QUITTING = [
  ["ask", "Ask"],
  ["keep", "Keep Marasi running"],
  ["stop", "Stop Marasi"],
];

/**
 * The connections the modal names: only when there are several, since one
 * owned run needs no name.
 */
export function namedConnections(question) {
  const connections = question?.connections ?? [];
  return connections.length > 1 ? connections : [];
}

/**
 * The answer Go gets for the modal's response. A modal closed without a
 * button (Escape, the backdrop) cancels the quit.
 */
export function quitAnswerOf(response) {
  const answer = response?.answer;
  if (answer === "keep" || answer === "stop") {
    return { answer, remember: response.remember === true };
  }
  return { answer: "cancel", remember: false };
}
