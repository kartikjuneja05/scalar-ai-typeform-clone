"use client";
import { use, useEffect, useState } from "react";
import Flow from "../../../components/Flow";
import { Form, api } from "../../../components/model";
export default function PublicForm({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Form>(`/public/${id}`)
      .then(setForm)
      .catch((e) => setError(e.message));
  }, [id]);
  return form ? (
    <Flow form={form} />
  ) : (
    <div className="loading">
      <h1>{error || "Getting your conversation ready…"}</h1>
      {error && <a href="/">Back to workspace</a>}
    </div>
  );
}
