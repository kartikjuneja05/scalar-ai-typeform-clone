"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Search,
  MoreHorizontal,
  LayoutGrid,
  List,
  ChevronDown,
  ExternalLink,
  Copy,
  Trash2,
  GripVertical,
  Eye,
  Check,
  Settings,
  Share2,
  BarChart3,
  Layers,
  Folder,
  PanelLeft,
  ArrowUp,
  ArrowDown,
  X,
  Download,
  Sparkles,
} from "lucide-react";
import {
  Form,
  Profile,
  creatorSession,
  Question,
  Kind,
  Submission,
  kinds,
  marks,
  newQuestion,
  api,
} from "../components/model";
import Flow, { Answer } from "../components/Flow";
import AccountDialog from "../components/AccountDialog";

export default function Workspace() {
  const [profile, setProfile] = useState<Profile>({
    name: "guest",
    email: null,
    is_guest: true,
  });
  const [identityReady, setIdentityReady] = useState(false);
  const [accountMode, setAccountMode] = useState<"register" | "login" | null>(
    null,
  );
  const [forms, setForms] = useState<Form[]>([]),
    [active, setActive] = useState<Form | null>(null),
    [tab, setTab] = useState("Create"),
    [pane, setPane] = useState("Content"),
    [selected, setSelected] = useState(0),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All forms"),
    [modal, setModal] = useState<"new" | "rename" | "delete" | "add" | null>(
      null,
    ),
    [target, setTarget] = useState<Form | null>(null),
    [title, setTitle] = useState(""),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [responses, setResponses] = useState<Submission[]>([]),
    [detail, setDetail] = useState<Submission | null>(null),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [menu, setMenu] = useState(""),
    [drag, setDrag] = useState<number | null>(null),
    [list, setList] = useState(false);
  async function reload() {
    try {
      setForms(await api<Form[]>("/forms"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    // Establish a cookie session before any creator requests to prevent guest races.
    creatorSession()
      .then(async (identity) => {
        setProfile(identity);
        setIdentityReady(true);
        await reload();
      })
      .catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (active && tab === "Results")
      api<Submission[]>(`/forms/${active.id}/responses`)
        .then(setResponses)
        .catch((e) => setToast(e.message));
  }, [tab, active?.id]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openAccount(mode: "register" | "login") {
    if (!identityReady) return;
    await run(async () => {
      if (dirty) await save();
      setAccountMode(mode);
    });
  }
  async function accountComplete(identity: Profile) {
    setProfile(identity);
    setAccountMode(null);
    setActive(null);
    setDirty(false);
    setResponses([]);
    setDetail(null);
    await reload();
    setToast(`Welcome, ${identity.name}.`);
  }
  async function signOut() {
    await run(async () => {
      if (dirty) await save();
      const guest = await api<Profile>("/auth/logout", "POST");
      setProfile(guest);
      setActive(null);
      setDirty(false);
      setResponses([]);
      setDetail(null);
      await reload();
      setToast("Signed out. You can continue as guest.");
    });
  }
  function open(form: Form) {
    setActive(form);
    setSelected(0);
    setTab("Create");
    setPane("Content");
    setDirty(false);
    setMenu("");
  }
  function change(data: Partial<Form>) {
    if (active) {
      setActive({ ...active, ...data });
      setDirty(true);
    }
  }
  function edit(data: Partial<Question>) {
    if (active)
      change({
        questions: active.questions.map((q, i) =>
          i === selected ? { ...q, ...data } : q,
        ),
      });
  }
  async function save() {
    if (!active) return;
    const updated = await api<Form>(`/forms/${active.id}`, "PUT", active);
    setActive(updated);
    setDirty(false);
    await reload();
    return updated;
  }
  async function leave() {
    await run(async () => {
      if (dirty) await save();
      setActive(null);
      await reload();
    });
  }
  async function publish() {
    await run(async () => {
      const saved = await save();
      if (saved) {
        setActive(await api<Form>(`/forms/${saved.id}/publish`, "POST"));
        setToast("Your form is live. Let the conversations begin.");
        setTab("Share");
        await reload();
      }
    });
  }
  function reorder(from: number, to: number) {
    if (!active || from === to) return;
    const questions = [...active.questions];
    questions.splice(to, 0, questions.splice(from, 1)[0]);
    change({ questions });
    setSelected(to);
  }
  const q = active?.questions[selected];
  const shown = forms.filter(
    (f) =>
      f.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "All forms" || f.status === filter.toLowerCase()),
  );
  const total = forms.reduce((sum, f) => sum + f.response_count, 0);
  async function copyLink() {
    if (active) {
      try {
        await navigator.clipboard.writeText(
          `${location.origin}/f/${active.id}`,
        );
        setToast("Link copied to clipboard");
      } catch {
        setToast("Select and copy the link below.");
      }
    }
  }
  return (
    <>
      {!active ? (
        <div className="workspace">
          <aside className="sidebar">
            <a className="brand" href="/">
              iLoveForms
            </a>
            <button
              className="workspace-switch"
              onClick={() =>
                profile.is_guest
                  ? openAccount("register")
                  : setToast(`Signed in as ${profile.email}`)
              }
            >
              <span className="avatar">
                {profile.is_guest ? "G" : profile.name.charAt(0).toUpperCase()}
              </span>
              <div>
                {profile.is_guest
                  ? "Guest workspace"
                  : `${profile.name}’s workspace`}
                <small>
                  {profile.is_guest ? "No account needed" : "Personal account"}
                </small>
              </div>
              <ChevronDown size={15} />
            </button>
            <div className="side-label">WORKSPACE</div>
            <button
              className="side-item selected"
              onClick={() => setFilter("All forms")}
            >
              <Folder size={18} />
              My forms<span>{forms.length}</span>
            </button>
            <button
              className="side-item"
              onClick={() =>
                setToast(
                  "Templates are coming soon. Start with one of the sample forms.",
                )
              }
            >
              <Layers size={18} />
              Templates
            </button>
            <button
              className="side-item"
              onClick={() => setToast("Team collaboration is coming soon.")}
            >
              <Share2 size={18} />
              Shared with me
            </button>
            <div className="sidebar-bottom">
              <div className="upgrade">
                <Sparkles size={20} />
                <h4>
                  Good questions.
                  <br />
                  Great possibilities.
                </h4>
                <p>Make every conversation count.</p>
                <span>Made for curious minds ↗</span>
              </div>
              <button
                className="side-item"
                onClick={() =>
                  profile.is_guest
                    ? openAccount("register")
                    : setToast(`Signed in as ${profile.email}`)
                }
              >
                <Settings size={17} />
                Settings
              </button>
              <div className="profile">
                <span className="avatar">
                  {profile.is_guest
                    ? "G"
                    : profile.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  {profile.name}
                  <small>
                    {profile.is_guest ? "Guest profile" : profile.email}
                  </small>
                </div>
                <MoreHorizontal size={18} />
              </div>
            </div>
          </aside>
          <main className="dashboard">
            <header className="workspace-header">
              <span>
                Workspace <span className="muted">/</span> <b>My forms</b>
              </span>
              <div className="account-header">
                <span className="account-name">{profile.name}</span>
                {profile.is_guest ? (
                  <>
                    <button
                      className="text-button"
                      disabled={!identityReady || busy}
                      onClick={() => openAccount("login")}
                    >
                      Sign in
                    </button>
                    <button
                      className="primary"
                      disabled={!identityReady || busy}
                      onClick={() => openAccount("register")}
                    >
                      Create account
                    </button>
                  </>
                ) : (
                  <button className="button" disabled={busy} onClick={signOut}>
                    Sign out
                  </button>
                )}
              </div>
            </header>
            <div className="dashboard-content">
              <div className="welcome">
                <div className="eyebrow">
                  YOUR WORKSPACE, YOUR POSSIBILITIES
                </div>
                <div className="title-row">
                  <div>
                    <h1>Make it a conversation.</h1>
                    <p>Build forms that feel human. Discover what matters.</p>
                  </div>
                  <button
                    className="primary"
                    disabled={!identityReady || busy}
                    onClick={() => {
                      setTitle("");
                      setModal("new");
                    }}
                  >
                    <Plus size={18} />
                    Create a form
                  </button>
                </div>
              </div>
              <div className="stats-strip">
                <div>
                  <span className="stat-icon">
                    <Folder size={18} />
                  </span>
                  <span>
                    <b>{forms.length}</b>
                    <small>Forms in your workspace</small>
                  </span>
                </div>
                <div>
                  <span className="stat-icon sage">
                    <Check size={18} />
                  </span>
                  <span>
                    <b>
                      {forms.filter((f) => f.status === "published").length}
                    </b>
                    <small>Live conversations</small>
                  </span>
                </div>
                <div>
                  <span className="stat-icon purple">
                    <BarChart3 size={18} />
                  </span>
                  <span>
                    <b>{total}</b>
                    <small>Responses collected</small>
                  </span>
                </div>
                <div className="stat-note">
                  Every response
                  <br />
                  starts with a good question. <span>↗</span>
                </div>
              </div>
              <div className="forms-toolbar">
                <div className="filter-tabs">
                  {["All forms", "Published", "Draft"].map((f) => (
                    <button
                      className={filter === f ? "active" : ""}
                      onClick={() => setFilter(f)}
                      key={f}
                    >
                      {f}
                      {f === "All forms" && <span>{forms.length}</span>}
                    </button>
                  ))}
                </div>
                <div className="toolbar-right">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search forms"
                      placeholder="Search forms"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="view-toggle">
                    <button
                      aria-label="Grid view"
                      className={!list ? "active" : ""}
                      onClick={() => setList(false)}
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      aria-label="List view"
                      className={list ? "active" : ""}
                      onClick={() => setList(true)}
                    >
                      <List size={17} />
                    </button>
                  </div>
                </div>
              </div>
              {error ? (
                <div className="empty">
                  <h3>We couldn’t load your forms.</h3>
                  <p>{error}</p>
                  <button
                    onClick={() =>
                      creatorSession()
                        .then(async (identity) => {
                          setProfile(identity);
                          setIdentityReady(true);
                          await reload();
                        })
                        .catch((error) => setError(error.message))
                    }
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className={"form-grid " + (list ? "list-view" : "")}>
                  {shown.map((f, i) => (
                    <article className="form-card" key={f.id}>
                      <button
                        className={"card-art theme-" + f.theme}
                        onClick={() => open(f)}
                      >
                        <span className="card-art-label">
                          {f.status === "published"
                            ? "A CONVERSATION STARTER"
                            : "A WORK IN PROGRESS"}
                        </span>
                        <div className={"abstract abstract-" + (i % 3)}>
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <span className="card-art-bottom">
                          {f.questions.length} questions{" "}
                          <ArrowRight size={17} />
                        </span>
                      </button>
                      <div className="card-info">
                        <div className="card-title-row">
                          <button
                            className="card-title"
                            onClick={() => open(f)}
                          >
                            {f.title}
                          </button>
                          <button
                            aria-label={`Options for ${f.title}`}
                            className="icon-button"
                            onClick={() => setMenu(menu === f.id ? "" : f.id)}
                          >
                            <MoreHorizontal size={20} />
                          </button>
                          {menu === f.id && (
                            <div className="dropdown-menu">
                              <button
                                onClick={() => {
                                  setTarget(f);
                                  setTitle(f.title);
                                  setModal("rename");
                                  setMenu("");
                                }}
                              >
                                Rename
                              </button>
                              <button
                                onClick={() =>
                                  run(async () => {
                                    await api(
                                      `/forms/${f.id}/duplicate`,
                                      "POST",
                                    );
                                    setMenu("");
                                    await reload();
                                    setToast("Form duplicated");
                                  })
                                }
                              >
                                <Copy size={14} />
                                Duplicate
                              </button>
                              <button
                                className="danger"
                                onClick={() => {
                                  setTarget(f);
                                  setModal("delete");
                                  setMenu("");
                                }}
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <p>
                          {f.response_count} responses <span>·</span> Edited{" "}
                          {new Date(f.updated_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                        <div className="card-bottom">
                          <span className={"status " + f.status}>
                            <i />
                            {f.status === "published" ? "Published" : "Draft"}
                          </span>
                          <button
                            onClick={() => {
                              open(f);
                              setTab("Results");
                            }}
                          >
                            View results <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  <button
                    className="new-card"
                    onClick={() => {
                      setTitle("");
                      setModal("new");
                    }}
                  >
                    <span>
                      <Plus size={25} />
                    </span>
                    <b>Start something new</b>
                    <p>A blank canvas for your next conversation.</p>
                  </button>
                </div>
              )}
              <div className="workspace-footer">
                <span>Thoughtful forms. Meaningful connections.</span>
                <span>Made with a little more human.</span>
              </div>
            </div>
          </main>
        </div>
      ) : (
        <div className="editor">
          <header className="editor-header">
            <div className="editor-heading">
              <button
                className="icon-button"
                aria-label="Back to workspace"
                onClick={leave}
              >
                <ArrowLeft size={19} />
              </button>
              <span className="brand mini">iLoveForms</span>
              <span className="divider" />
              <input
                aria-label="Form title"
                value={active.title}
                onChange={(e) => change({ title: e.target.value })}
              />
              <span className="save-status">
                {dirty ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
            <div className="editor-tools">
              {profile.is_guest && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => openAccount("register")}
                >
                  Create account
                </button>
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await save();
                    setToast("Changes saved");
                  })
                }
              >
                Save
              </button>
              <button className="button" onClick={() => setPreview(true)}>
                <Eye size={16} />
                Preview
              </button>
              <button className="primary" disabled={busy} onClick={publish}>
                Publish <ArrowRight size={16} />
              </button>
            </div>
          </header>
          <nav className="editor-nav">
            {["Create", "Connect", "Share", "Results"].map((t) => (
              <button
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
                {t === "Results" && <span>{active.response_count}</span>}
              </button>
            ))}
          </nav>
          {tab === "Create" ? (
            <div className="builder">
              <aside className="question-sidebar">
                <div className="builder-tabs">
                  {["Content", "Design", "Logic"].map((p) => (
                    <button
                      key={p}
                      className={pane === p ? "active" : ""}
                      onClick={() => setPane(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {pane === "Content" ? (
                  <>
                    <div className="question-list">
                      {active.questions.map((question, i) => (
                        <div
                          draggable
                          onDragStart={() => setDrag(i)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (drag !== null) reorder(drag, i);
                            setDrag(null);
                          }}
                          className={
                            "question-item " + (selected === i ? "active" : "")
                          }
                          key={question.id}
                        >
                          <GripVertical size={14} />
                          <button onClick={() => setSelected(i)}>
                            <span className={"type-icon type-" + question.type}>
                              {marks[question.type]}
                            </span>
                            <span>
                              <small>
                                {i + 1} · {kinds[question.type]}
                              </small>
                              {question.title}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="add-question"
                      onClick={() => setModal("add")}
                    >
                      <Plus size={17} />
                      Add content
                    </button>
                    <button
                      className="ending-item"
                      onClick={() => setPane("Design")}
                    >
                      <Check size={16} />
                      Thank-you screen
                    </button>
                    <div className="builder-hint">
                      A good form feels like
                      <br />a good conversation.
                    </div>
                  </>
                ) : pane === "Design" ? (
                  <div className="design-panel">
                    <h3>Make it yours</h3>
                    <p>Choose the mood of your conversation.</p>
                    {["paper", "sage", "lavender", "night"].map((theme) => (
                      <button
                        key={theme}
                        className={
                          "theme-option theme-" +
                          theme +
                          (active.theme === theme ? " picked" : "")
                        }
                        onClick={() => change({ theme })}
                      >
                        {theme.charAt(0).toUpperCase() + theme.slice(1)}
                        {active.theme === theme && <Check size={16} />}
                      </button>
                    ))}
                    <label>
                      Thank-you message
                      <textarea
                        value={active.thank_you}
                        onChange={(e) => change({ thank_you: e.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="placeholder">
                    <Layers size={32} />
                    <h3>A little more logic</h3>
                    <p>Conditional branching is coming soon.</p>
                  </div>
                )}
              </aside>
              <section className="canvas">
                <div className="canvas-toolbar">
                  <span>LIVE PREVIEW</span>
                  <span>
                    <PanelLeft size={15} /> Desktop
                  </span>
                </div>
                <div className={"question-canvas theme-" + active.theme}>
                  {q ? (
                    <div className="canvas-content">
                      <div className="question-number">
                        {selected + 1}
                        <ArrowRight size={17} />
                      </div>
                      <input
                        className="question-title"
                        aria-label="Question title"
                        value={q.title}
                        onChange={(e) => edit({ title: e.target.value })}
                      />
                      <textarea
                        className="question-description"
                        aria-label="Question description"
                        placeholder="Add a description (optional)"
                        value={q.description}
                        onChange={(e) => edit({ description: e.target.value })}
                      />
                      <Answer q={q} value={undefined} set={() => {}} disabled />
                      <button
                        className="flow-button"
                        onClick={() => setPreview(true)}
                      >
                        OK <Check size={17} />
                      </button>
                      <small>
                        press <b>Enter ↵</b>
                      </small>
                    </div>
                  ) : (
                    <div className="canvas-empty">
                      <Plus size={32} />
                      <h2>
                        Every conversation starts
                        <br />
                        with a question.
                      </h2>
                      <button
                        className="flow-button"
                        onClick={() => setModal("add")}
                      >
                        Add your first question
                      </button>
                    </div>
                  )}
                  <span className="canvas-brand">
                    Powered by <b>iLoveForms</b>
                  </span>
                </div>
                <div className="canvas-bottom">
                  <span>Click the question or description to edit</span>
                  <button onClick={() => setPreview(true)}>
                    Try the full experience <ExternalLink size={13} />
                  </button>
                </div>
              </section>
              <aside className="settings-panel">
                <h3>Question settings</h3>
                {q ? (
                  <>
                    <label>
                      Question type
                      <select
                        value={q.type}
                        onChange={(e) => {
                          const type = e.target.value as Kind;
                          edit({
                            type,
                            options: ["multiple_choice", "dropdown"].includes(
                              type,
                            )
                              ? q.options.length
                                ? q.options
                                : ["Option 1", "Option 2"]
                              : [],
                          });
                        }}
                      >
                        {Object.entries(kinds).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="toggle-row">
                      <span>Required</span>
                      <button
                        aria-label="Required question"
                        aria-pressed={q.required}
                        className={"toggle " + (q.required ? "on" : "")}
                        onClick={() => edit({ required: !q.required })}
                      >
                        <i />
                      </button>
                    </div>
                    <p className="helper">
                      Make sure this question gets an answer.
                    </p>
                    {["multiple_choice", "dropdown"].includes(q.type) && (
                      <div className="option-editor">
                        <label>Answer choices</label>
                        {q.options.map((option, i) => (
                          <div key={i}>
                            <kbd>{String.fromCharCode(65 + i)}</kbd>
                            <input
                              aria-label={`Choice ${i + 1}`}
                              value={option}
                              onChange={(e) =>
                                edit({
                                  options: q.options.map((o, n) =>
                                    n === i ? e.target.value : o,
                                  ),
                                })
                              }
                            />
                            <button
                              aria-label={`Delete choice ${i + 1}`}
                              className="icon-button"
                              onClick={() =>
                                edit({
                                  options: q.options.filter((_, n) => i !== n),
                                })
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                        <button
                          className="text-button"
                          onClick={() =>
                            edit({
                              options: [
                                ...q.options,
                                `Option ${q.options.length + 1}`,
                              ],
                            })
                          }
                        >
                          <Plus size={14} />
                          Add choice
                        </button>
                      </div>
                    )}
                    <div className="question-operations">
                      <button
                        className="button"
                        disabled={selected === 0}
                        onClick={() => reorder(selected, selected - 1)}
                      >
                        <ArrowUp size={15} />
                        Move up
                      </button>
                      <button
                        className="button"
                        disabled={selected === active.questions.length - 1}
                        onClick={() => reorder(selected, selected + 1)}
                      >
                        <ArrowDown size={15} />
                        Move down
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          const questions = [...active.questions];
                          questions.splice(selected + 1, 0, {
                            ...q,
                            id: crypto.randomUUID(),
                          });
                          change({ questions });
                          setSelected(selected + 1);
                        }}
                      >
                        <Copy size={15} />
                        Duplicate question
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => {
                          change({
                            questions: active.questions.filter(
                              (_, i) => i !== selected,
                            ),
                          });
                          setSelected(Math.max(0, selected - 1));
                        }}
                      >
                        <Trash2 size={15} />
                        Delete question
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="helper">Add a question to see its settings.</p>
                )}
                <div className="settings-note">
                  <Sparkles size={18} />
                  <p>
                    Keep it simple.
                    <br />
                    One question, one thought.
                  </p>
                </div>
              </aside>
            </div>
          ) : tab === "Share" ? (
            <div className="share-page">
              <span className="big-icon">
                <Share2 size={28} />
              </span>
              <div className="eyebrow">
                GOOD CONVERSATIONS DESERVE TO BE SHARED
              </div>
              <h1>Let the answers come to you.</h1>
              <p>
                Send your form to anyone. They can respond without an account.
              </p>
              {active.status === "published" ? (
                <>
                  <div className="share-link">
                    <input
                      aria-label="Public form link"
                      readOnly
                      value={
                        typeof window !== "undefined"
                          ? `${location.origin}/f/${active.id}`
                          : ""
                      }
                    />
                    <button className="primary" onClick={copyLink}>
                      <Copy size={16} />
                      Copy link
                    </button>
                  </div>
                  <div className="share-buttons">
                    <a
                      className="button"
                      href={`/f/${active.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open form <ExternalLink size={15} />
                    </a>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          setActive(
                            await api<Form>(
                              `/forms/${active.id}/unpublish`,
                              "POST",
                            ),
                          );
                          await reload();
                          setToast("Form unpublished");
                        })
                      }
                    >
                      Unpublish form
                    </button>
                  </div>
                  <p className="helper">
                    Your saved edits go live when you click Publish.
                  </p>
                </>
              ) : (
                <button className="primary" onClick={publish}>
                  Publish your form <ArrowRight size={16} />
                </button>
              )}
            </div>
          ) : tab === "Connect" ? (
            <div className="placeholder full">
              <Layers size={40} />
              <h1>Better together.</h1>
              <p>Integrations and webhooks are coming soon.</p>
              <span className="status draft">Coming soon</span>
            </div>
          ) : (
            <div className="results-page">
              <div className="title-row">
                <div>
                  <div className="eyebrow">LISTEN, LEARN, GROW</div>
                  <h1>Every answer tells a story.</h1>
                  <p>
                    {responses.length} responses to {active.title}
                  </p>
                </div>
                <a className="button" href={`/api/forms/${active.id}/export`}>
                  <Download size={16} />
                  Export CSV
                </a>
              </div>
              <div className="summary-grid">
                {active.questions
                  .filter((q) =>
                    [
                      "multiple_choice",
                      "dropdown",
                      "yes_no",
                      "rating",
                    ].includes(q.type),
                  )
                  .map((q) => {
                    const options =
                      q.type === "yes_no"
                        ? ["Yes", "No"]
                        : q.type === "rating"
                          ? ["1", "2", "3", "4", "5"]
                          : q.options;
                    const answered = responses.filter(
                      (r) => r.answers[q.id] !== undefined,
                    ).length;
                    return (
                      <div className="summary-card" key={q.id}>
                        <span className={"type-icon type-" + q.type}>
                          {marks[q.type]}
                        </span>
                        <h3>{q.title}</h3>
                        <small>{answered} answers</small>
                        {options.map((o) => {
                          const count = responses.filter(
                            (r) => String(r.answers[q.id]) === o,
                          ).length;
                          return (
                            <div className="stat-bar" key={o}>
                              <span>
                                {o}
                                <b>{count}</b>
                              </span>
                              <div>
                                <i
                                  style={{
                                    width: `${answered ? (count / answered) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
              <h3>All responses</h3>
              {responses.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        {active.questions.slice(0, 4).map((q) => (
                          <th key={q.id}>{q.title}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {responses.map((r) => (
                        <tr key={r.id} onClick={() => setDetail(r)}>
                          <td>{new Date(r.submitted_at).toLocaleString()}</td>
                          {active.questions.slice(0, 4).map((q) => (
                            <td key={q.id}>{r.answers[q.id] ?? "—"}</td>
                          ))}
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setDetail(r)}
                            >
                              View <ArrowRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <h3>Your next conversation is waiting.</h3>
                  <p>
                    Publish and share your form to start collecting responses.
                  </p>
                  <button className="primary" onClick={() => setTab("Share")}>
                    Share form
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {preview && active && (
        <div className="preview-overlay">
          <Flow form={active} preview onClose={() => setPreview(false)} />
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={"modal " + (modal === "add" ? "wide" : "")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Close dialog"
              className="modal-close icon-button"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "add" ? (
              <>
                <div className="eyebrow">MAKE ROOM FOR A GOOD QUESTION</div>
                <h2 id="modal-title">What would you like to ask?</h2>
                <p>Choose a question type to get started.</p>
                <div className="question-types">
                  {Object.entries(kinds).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => {
                        if (active) {
                          change({
                            questions: [
                              ...active.questions,
                              newQuestion(kind as Kind),
                            ],
                          });
                          setSelected(active.questions.length);
                          setModal(null);
                        }
                      }}
                    >
                      <span className={"type-icon type-" + kind}>
                        {marks[kind as Kind]}
                      </span>
                      <span>{label}</span>
                      <Plus size={15} />
                    </button>
                  ))}
                </div>
              </>
            ) : modal === "delete" ? (
              <>
                <h2 id="modal-title">Delete this form?</h2>
                <p>
                  “{target?.title}” and all its responses will be permanently
                  deleted.
                </p>
                <div className="modal-actions">
                  <button className="button" onClick={() => setModal(null)}>
                    Keep form
                  </button>
                  <button
                    disabled={busy}
                    className="primary destructive"
                    onClick={() =>
                      run(async () => {
                        await api(`/forms/${target?.id}`, "DELETE");
                        setModal(null);
                        await reload();
                        setToast("Form deleted");
                      })
                    }
                  >
                    Delete form
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    if (modal === "new") {
                      const f = await api<Form>("/forms", "POST", {
                        title: title.trim(),
                        questions: [],
                      });
                      open(f);
                    } else if (target)
                      await api(`/forms/${target.id}`, "PUT", {
                        ...target,
                        title: title.trim(),
                      });
                    setModal(null);
                    await reload();
                    setToast(
                      modal === "new"
                        ? "Your blank canvas is ready"
                        : "Form renamed",
                    );
                  });
                }}
              >
                <div className="eyebrow">IT STARTS WITH A LITTLE CURIOSITY</div>
                <h2 id="modal-title">
                  {modal === "new"
                    ? "Give your conversation a name."
                    : "Rename your form."}
                </h2>
                <p>You can always change it later.</p>
                <label>
                  Form name
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Get to know our customers"
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !title.trim() || !identityReady}
                  >
                    {modal === "new" ? "Create form" : "Save name"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div
            className="modal response-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Response details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Close response"
              className="modal-close icon-button"
              onClick={() => setDetail(null)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">ONE PERSON. A NEW PERSPECTIVE.</div>
            <h2>A closer look.</h2>
            <p>
              {new Date(detail.submitted_at).toLocaleString()} · Version{" "}
              {detail.snapshot.version}
            </p>
            {detail.snapshot.questions.map((q, i) => (
              <div className="detail-answer" key={q.id}>
                <small>
                  {i + 1} · {q.title}
                </small>
                <p>{detail.answers[q.id] ?? "No answer"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {accountMode && (
        <AccountDialog
          mode={accountMode}
          onClose={() => setAccountMode(null)}
          onComplete={accountComplete}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
