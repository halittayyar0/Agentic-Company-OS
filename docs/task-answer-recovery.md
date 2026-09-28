# Answering an agent's question

The project page shows the recorded question when a task needs operator input. The question is source content: changing the interface language does not translate the decision you are reviewing. The form, validation and recovery messages support Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic.

Write an answer of up to 1,200 characters. The answer draft survives navigation and reloads in the **same browser tab**. It is not a cross-device draft, and closing the tab may remove it. Do not put credentials in an answer. If the question changes, the form retains your draft and requires opening the current question before sending.

## An interrupted send

- **Answer recorded** means the answer and scheduling change committed on the server. It does not mean the task has run or succeeded.
- **Delivery unconfirmed** means the browser has no valid receipt yet. The answer is locked to its original question and request. Reloading does not resend it.
- **Check delivery** reads the saved receipt without starting work.
- A missing receipt is not proof that an in-flight transaction cannot commit. The explicit retry sends the **same request identity, question and answer**. The server applies it at most once.
- A recorded rejection leaves the draft available for review. A changed question, changed task/owner, inactive owner or emergency stop does not resume work.
- If the browser cannot store recovery details, that send is blocked. The text remains on screen; copy it before leaving.

The server receipt can be read from any authenticated client with its task and request identities. The current interface retains those identities within the sending tab; it does not claim cross-device outbox discovery.

## API contract and upgrade

Migration `0022_task_answer_requests` adds a question identity, recorded question and issuing owner to tasks, plus durable answer receipts. Both durable and legacy task execution paths create a fresh question identity when asking for input. Questions must contain visible text and fit within 1,000 characters; invalid questions are rejected before a wait is created. Audit redaction is applied before persistence.

Existing idle `user_input` waits are upgraded only when the current owner's latest recorded question exists and has no later recorded answer. Generic `last_error` messages are never substituted for a question. A legacy question at the old 1,000 UTF-16-unit truncation boundary (including supplementary Unicode characters) is ambiguous and is not revived. An invalid latest question never falls back to an older one. A legacy wait without this evidence remains unanswerable; review its original activity and create a replacement task with the operator's decision instead of guessing the missing question.

Upgrade API and worker processes together. An older worker cannot create the new question identity; a wait it writes during a mixed-version deployment is therefore unanswerable through the new endpoint. Stop older workers before applying the upgrade, then start the updated processes.

This changes the alpha resume contract. External clients must update:

| Operation                                    | Contract                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/tasks/{taskId}/question`           | Current question ID, source text, issuing owner and answerability snapshot. The POST revalidates all mutable conditions.       |
| `POST /api/tasks/{taskId}/resume`            | Required `requestId` UUID, `questionId` UUID and `answer`. Returns a durable accepted/rejected receipt, **not a Task object**. |
| `GET /api/tasks/{taskId}/resume/{requestId}` | Read-only receipt recovery. `404` means no committed matching receipt is visible yet.                                          |

The permanent request hash binds the task, exact question and trimmed answer. Reusing an identity for different content returns `409`. Replaying an accepted or rejected request returns its original receipt, including after task deletion, later questions or emergency stop. Rejection does not allow the same request identity to become accepted later; review the current question before creating a new intent.

The transaction locks runtime admission, then the owner, approvals and task. It rechecks that the locked owner still matches, that the issuing owner has not changed, that the task is an idle `user_input` wait, and that the exact question is current. Recording the answer, clearing the question, scheduling the task and saving its receipt commit together. Receipt persistence failure rolls all of these back. The receipt table deliberately has no task foreign key, so deleting a task cannot free a request identity for reuse.

PGlite tests cover those invariants and the migration. Independent native PostgreSQL connections, distributed race scheduling and real-device network interruption still need their own environment evidence.
