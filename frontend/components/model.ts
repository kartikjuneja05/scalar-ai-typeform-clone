export type Profile = { name: string; email: string | null; is_guest: boolean };
export type Kind =
  | "short_text"
  | "long_text"
  | "email"
  | "number"
  | "multiple_choice"
  | "dropdown"
  | "yes_no"
  | "rating";
export type Question = {
  id: string;
  type: Kind;
  title: string;
  description: string;
  required: boolean;
  options: string[];
};
export type Form = {
  id: string;
  title: string;
  questions: Question[];
  status: "draft" | "published";
  theme: string;
  thank_you: string;
  version: number;
  response_count: number;
  updated_at: string;
};
export type Submission = {
  id: string;
  submitted_at: string;
  snapshot: Form;
  answers: Record<string, string | number>;
};
export const kinds: Record<Kind, string> = {
  short_text: "Short text",
  long_text: "Long text",
  multiple_choice: "Multiple choice",
  dropdown: "Dropdown",
  email: "Email",
  number: "Number",
  yes_no: "Yes / No",
  rating: "Rating",
};
export const marks: Record<Kind, string> = {
  short_text: "T",
  long_text: "¶",
  multiple_choice: "☷",
  dropdown: "⌄",
  email: "@",
  number: "#",
  yes_no: "✓",
  rating: "★",
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      throw new Error(
        "The API is unavailable. Please check the backend and try again.",
      );
    }
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg || "Invalid input").join("; ")
          : detail && typeof detail === "object"
            ? Object.values(detail).join("; ")
            : `Request failed (${res.status}). Please try again.`;
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const newQuestion = (type: Kind): Question => ({
  id: crypto.randomUUID(),
  type,
  title:
    kinds[type] === "Email"
      ? "What’s your email address?"
      : "Your question goes here",
  description: "",
  required: false,
  options: ["multiple_choice", "dropdown"].includes(type)
    ? ["Option 1", "Option 2", "Option 3"]
    : [],
});
export function validate(q: Question, value: unknown) {
  if (
    value === undefined ||
    value === "" ||
    value === null ||
    (typeof value === "string" && !value.trim())
  )
    return q.required ? "Please answer this question." : "";
  if (
    ["short_text", "long_text", "email"].includes(q.type) &&
    String(value).length > 10000
  )
    return "Please keep your answer under 10,000 characters.";
  if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
    return "Please enter a valid email address.";
  if (q.type === "number" && !Number.isFinite(Number(value)))
    return "Please enter a valid number.";
  if (
    ["multiple_choice", "dropdown"].includes(q.type) &&
    !q.options.includes(String(value))
  )
    return "Please choose an available option.";
  if (q.type === "yes_no" && value !== "Yes" && value !== "No")
    return "Please choose Yes or No.";
  if (
    q.type === "rating" &&
    (typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 5)
  )
    return "Please choose a rating from 1 to 5.";
  return "";
}

// Share only the in-flight bootstrap request so development Strict Mode cannot
// create two competing guest cookies. Later mounts still read the current session.
let sessionRequest: Promise<Profile> | null = null;
export function creatorSession(): Promise<Profile> {
  if (!sessionRequest) {
    sessionRequest = api<Profile>("/auth/session").finally(() => {
      sessionRequest = null;
    });
  }
  return sessionRequest;
}
