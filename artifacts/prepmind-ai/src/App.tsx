import { useState, useRef, useEffect, useCallback } from "react";
import "./index.css";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function* readSSE(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6));
        } catch {}
      }
    }
  }
}

interface MCQQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  trick?: string;
  topic: string;
  difficulty: string;
}

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
}

interface TopicProgress {
  correct: number;
  incorrect: number;
}

type Tab = "overview" | "practice" | "teach" | "doubt" | "progress";

const LOADING_STEPS = [
  "Analyzing exam pattern...",
  "Loading syllabus topics...",
  "Preparing AI coach...",
  "Setting up practice arena...",
  "Your prep dashboard is ready!",
];

export default function App() {
  const [examName, setExamName] = useState("");
  const [activeExam, setActiveExam] = useState("");
  const [phase, setPhase] = useState<"landing" | "loading" | "dashboard">("landing");
  const [loadingStep, setLoadingStep] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [overviewText, setOverviewText] = useState("");
  const [syllabusTopics, setSyllabusTopics] = useState<string[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [practiceTopicFilter, setPracticeTopicFilter] = useState("All Topics");
  const [practiceDifficulty, setPracticeDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [practiceQuestions, setPracticeQuestions] = useState<MCQQuestion[]>([]);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [answeredMap, setAnsweredMap] = useState<Record<string, number>>({});
  const [expandedExplanation, setExpandedExplanation] = useState<string | null>(null);

  const [teachTopics, setTeachTopics] = useState<string[]>([]);
  const [teachingContent, setTeachingContent] = useState<Record<string, string>>({});
  const [teachingLoading, setTeachingLoading] = useState<Record<string, boolean>>({});
  const [expandedTeachTopic, setExpandedTeachTopic] = useState<string | null>(null);

  const [convId, setConvId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [topicProgress, setTopicProgress] = useState<Record<string, TopicProgress>>({});

  const totalAnswered = Object.values(topicProgress).reduce((s, t) => s + t.correct + t.incorrect, 0);
  const totalCorrect = Object.values(topicProgress).reduce((s, t) => s + t.correct, 0);
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const parseTopics = useCallback((text: string) => {
    const match = text.match(/TOPICS:\s*([^\n]+)/i);
    if (match) {
      return match[1].split(",").map((t) => t.trim()).filter(Boolean);
    }
    return [];
  }, []);

  const startPrep = async () => {
    if (!examName.trim()) return;
    const exam = examName.trim();
    setActiveExam(exam);
    setPhase("loading");
    setLoadingStep(0);
    setOverviewText("");
    setSyllabusTopics([]);
    setPracticeQuestions([]);
    setAnsweredMap({});
    setTopicProgress({});
    setTeachingContent({});
    setChatMessages([]);
    setConvId(null);

    for (let i = 0; i < LOADING_STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, 600));
      setLoadingStep(i);
    }
    await new Promise((r) => setTimeout(r, 400));
    setPhase("dashboard");
    setActiveTab("overview");
    fetchOverview(exam);
  };

  const fetchOverview = async (exam: string) => {
    setOverviewLoading(true);
    setOverviewText("");
    setSyllabusTopics([]);
    try {
      const res = await fetch(`${BASE}/api/prepmind/overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examName: exam }),
      });
      let full = "";
      for await (const chunk of readSSE(res)) {
        if (chunk.done) break;
        if (chunk.content) {
          full += chunk.content;
          setOverviewText(full);
          const topics = parseTopics(full);
          if (topics.length > 0) {
            setSyllabusTopics(topics);
            setTeachTopics(topics);
          }
        }
      }
    } finally {
      setOverviewLoading(false);
    }
  };

  const generatePractice = async () => {
    setPracticeLoading(true);
    setPracticeQuestions([]);
    setAnsweredMap({});
    setExpandedExplanation(null);
    try {
      const topic = practiceTopicFilter === "All Topics"
        ? syllabusTopics[Math.floor(Math.random() * syllabusTopics.length)] || "General"
        : practiceTopicFilter;
      const res = await fetch(`${BASE}/api/prepmind/practice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examName: activeExam, topic, difficulty: practiceDifficulty, count: 5 }),
      });
      const data = await res.json();
      if (data.questions) setPracticeQuestions(data.questions);
    } finally {
      setPracticeLoading(false);
    }
  };

  const answerQuestion = (qId: string, optionIdx: number, correctIdx: number, topic: string) => {
    if (answeredMap[qId] !== undefined) return;
    setAnsweredMap((prev) => ({ ...prev, [qId]: optionIdx }));
    const isCorrect = optionIdx === correctIdx;
    setTopicProgress((prev) => {
      const existing = prev[topic] || { correct: 0, incorrect: 0 };
      return {
        ...prev,
        [topic]: {
          correct: existing.correct + (isCorrect ? 1 : 0),
          incorrect: existing.incorrect + (isCorrect ? 0 : 1),
        },
      };
    });
  };

  const loadTeachTopic = async (topic: string) => {
    if (teachingContent[topic] || teachingLoading[topic]) {
      setExpandedTeachTopic((prev) => (prev === topic ? null : topic));
      return;
    }
    setExpandedTeachTopic(topic);
    setTeachingLoading((prev) => ({ ...prev, [topic]: true }));
    try {
      const res = await fetch(`${BASE}/api/prepmind/teach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examName: activeExam, topic }),
      });
      let full = "";
      for await (const chunk of readSSE(res)) {
        if (chunk.done) break;
        if (chunk.content) {
          full += chunk.content;
          setTeachingContent((prev) => ({ ...prev, [topic]: full }));
        }
      }
    } finally {
      setTeachingLoading((prev) => ({ ...prev, [topic]: false }));
    }
  };

  const initChat = async () => {
    if (convId) return;
    try {
      const res = await fetch(`${BASE}/api/anthropic/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${activeExam} Doubt Session` }),
      });
      const conv = await res.json();
      setConvId(conv.id);
    } catch {}
  };

  useEffect(() => {
    if (activeTab === "doubt" && !convId && activeExam) {
      initChat();
    }
  }, [activeTab, activeExam]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  const sendMessage = async () => {
    if (!chatInput.trim() || !convId || chatStreaming) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatStreaming(true);
    setStreamingContent("");

    try {
      const systemContext = `You are an expert ${activeExam} exam preparation coach. Help the student with their doubts, explain concepts clearly, solve problems step by step, and provide exam-specific tips. Keep responses concise and focused.`;
      const res = await fetch(`${BASE}/api/anthropic/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMsg, systemContext }),
      });
      let full = "";
      for await (const chunk of readSSE(res)) {
        if (chunk.done) break;
        if (chunk.content) {
          full += chunk.content;
          setStreamingContent(full);
        }
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setStreamingContent("");
    } finally {
      setChatStreaming(false);
    }
  };

  const formatMarkdown = (text: string) => {
    return text
      .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li class="md-li">$1</li>')
      .replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul class="md-ul">$&</ul>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="md-li md-oli"><span class="md-num">$1</span> $2</li>')
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
      .replace(/\n\n/g, '</p><p class="md-p">')
      .replace(/^(?!<[h|u|l|p])/gm, "")
      || text;
  };

  if (phase === "landing") {
    return (
      <div className="landing">
        <div className="landing-bg">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="grid-overlay" />
        </div>
        <div className="landing-content">
          <div className="badge-pill">AI-Powered Exam Prep</div>
          <h1 className="landing-title">
            Crack Any Exam<br />
            <span className="accent">with AI</span>
          </h1>
          <p className="landing-sub">
            Enter your exam name and get a personalized prep dashboard with<br />
            practice questions, AI tutoring, and doubt solving.
          </p>
          <form
            className="landing-form"
            onSubmit={(e) => { e.preventDefault(); startPrep(); }}
          >
            <input
              className="exam-input"
              type="text"
              placeholder="e.g. TCS NQT, CAT, GATE, SBI PO, UPSC..."
              value={examName}
              onChange={(e) => setExamName(e.target.value)}
              autoFocus
            />
            <button className="start-btn" type="submit" disabled={!examName.trim()}>
              Start Preparing
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </form>
          <div className="exam-chips">
            {["TCS NQT", "CAT", "GATE", "SBI PO", "UPSC", "JEE", "NEET", "GRE"].map((e) => (
              <button key={e} className="exam-chip" onClick={() => { setExamName(e); }}>
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="loading-screen">
        <div className="loading-logo">
          <div className="logo-icon">PM</div>
          <span>PrepMind AI</span>
        </div>
        <h2 className="loading-exam">{activeExam}</h2>
        <div className="loading-steps">
          {LOADING_STEPS.map((step, i) => (
            <div
              key={i}
              className={`loading-step ${i <= loadingStep ? "active" : ""} ${i === loadingStep ? "current" : ""}`}
            >
              <div className="step-dot">
                {i < loadingStep ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#06060a" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                ) : i === loadingStep ? (
                  <div className="dot-pulse" />
                ) : null}
              </div>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "📋" },
    { id: "practice", label: "Practice", icon: "⚡" },
    { id: "teach", label: "Teach Me", icon: "📚" },
    { id: "doubt", label: "Ask Doubt", icon: "💬" },
    { id: "progress", label: "Progress", icon: "📈" },
  ];

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-logo">
          <div className="logo-icon sm">PM</div>
          <span>PrepMind AI</span>
        </div>
        <div className="exam-tag">{activeExam}</div>
        <button className="change-btn" onClick={() => setPhase("landing")}>
          Change Exam
        </button>
      </header>
      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="dash-main">
        {activeTab === "overview" && (
          <div className="tab-content">
            <div className="tab-header">
              <h2>Exam Overview</h2>
              <button
                className="refresh-btn"
                onClick={() => fetchOverview(activeExam)}
                disabled={overviewLoading}
              >
                {overviewLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            {overviewLoading && !overviewText && (
              <div className="skeleton-lines">
                {[1,2,3,4,5].map(i => <div key={i} className="skeleton-line" style={{width: `${70 + i * 5}%`}} />)}
              </div>
            )}
            {overviewText && (
              <div className="overview-content">
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: `<p class="md-p">${formatMarkdown(overviewText)}</p>` }}
                />
              </div>
            )}
            {syllabusTopics.length > 0 && (
              <div className="syllabus-section">
                <h3>Syllabus Topics</h3>
                <div className="topic-chips">
                  {syllabusTopics.map((topic) => (
                    <button
                      key={topic}
                      className="topic-chip"
                      onClick={() => {
                        setPracticeTopicFilter(topic);
                        setActiveTab("practice");
                      }}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "practice" && (
          <div className="tab-content">
            <div className="tab-header">
              <h2>Practice Questions</h2>
            </div>
            <div className="practice-filters">
              <div className="filter-group">
                <label>Topic</label>
                <select
                  value={practiceTopicFilter}
                  onChange={(e) => setPracticeTopicFilter(e.target.value)}
                  className="filter-select"
                >
                  <option value="All Topics">All Topics</option>
                  {syllabusTopics.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label>Difficulty</label>
                <div className="diff-pills">
                  {(["Easy", "Medium", "Hard"] as const).map((d) => (
                    <button
                      key={d}
                      className={`diff-pill ${practiceDifficulty === d ? "active" : ""} diff-${d.toLowerCase()}`}
                      onClick={() => setPracticeDifficulty(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="generate-btn"
                onClick={generatePractice}
                disabled={practiceLoading}
              >
                {practiceLoading ? (
                  <span className="spin-dot" />
                ) : null}
                {practiceLoading ? "Generating..." : "Generate Questions"}
              </button>
            </div>

            {practiceLoading && (
              <div className="loading-card">
                <div className="loading-orb" />
                <p>Creating {practiceDifficulty} questions on {practiceTopicFilter}...</p>
              </div>
            )}

            <div className="questions-list">
              {practiceQuestions.map((q, qi) => {
                const answered = answeredMap[q.id] !== undefined;
                const selected = answeredMap[q.id];
                const isExpanded = expandedExplanation === q.id;
                return (
                  <div key={q.id} className={`question-card ${answered ? "answered" : ""}`}>
                    <div className="q-header">
                      <span className="q-num">Q{qi + 1}</span>
                      <span className={`q-diff diff-${q.difficulty.toLowerCase()}`}>{q.difficulty}</span>
                    </div>
                    <p className="q-text">{q.question}</p>
                    <div className="options-grid">
                      {q.options.map((opt, oi) => {
                        let cls = "option-btn";
                        if (answered) {
                          if (oi === q.correctIndex) cls += " correct";
                          else if (oi === selected) cls += " wrong";
                          else cls += " dim";
                        }
                        return (
                          <button
                            key={oi}
                            className={cls}
                            onClick={() => answerQuestion(q.id, oi, q.correctIndex, q.topic)}
                            disabled={answered}
                          >
                            <span className="opt-label">{["A","B","C","D"][oi]}</span>
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {answered && (
                      <div className="answer-result">
                        <div className={`result-badge ${selected === q.correctIndex ? "correct" : "wrong"}`}>
                          {selected === q.correctIndex ? "✓ Correct!" : "✗ Incorrect"}
                        </div>
                        <button
                          className="explain-toggle"
                          onClick={() => setExpandedExplanation(isExpanded ? null : q.id)}
                        >
                          {isExpanded ? "Hide" : "Show"} Explanation
                        </button>
                      </div>
                    )}
                    {answered && isExpanded && (
                      <div className="explanation-box">
                        <p><strong>Explanation:</strong> {q.explanation}</p>
                        {q.trick && (
                          <p className="trick-box">
                            <span className="trick-label">⚡ Trick:</span> {q.trick}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {practiceQuestions.length === 0 && !practiceLoading && (
              <div className="empty-state">
                <div className="empty-icon">⚡</div>
                <p>Generate questions to start practicing</p>
                <p className="empty-sub">Select topic and difficulty, then click Generate</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "teach" && (
          <div className="tab-content">
            <div className="tab-header">
              <h2>Teach Me</h2>
            </div>
            {teachTopics.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">📚</div>
                <p>Load the Overview tab first to get syllabus topics</p>
              </div>
            )}
            <div className="teach-list">
              {teachTopics.map((topic) => {
                const isOpen = expandedTeachTopic === topic;
                const content = teachingContent[topic];
                const loading = teachingLoading[topic];
                return (
                  <div key={topic} className={`teach-card ${isOpen ? "open" : ""}`}>
                    <button
                      className="teach-header"
                      onClick={() => loadTeachTopic(topic)}
                    >
                      <span className="teach-topic">{topic}</span>
                      <span className="teach-chevron">{isOpen ? "▲" : "▼"}</span>
                    </button>
                    {isOpen && (
                      <div className="teach-body">
                        {loading && (
                          <div className="teach-loading">
                            <div className="loading-orb sm" />
                            <span>AI is preparing to teach you {topic}...</span>
                          </div>
                        )}
                        {content && (
                          <div
                            className="markdown-body"
                            dangerouslySetInnerHTML={{ __html: `<p class="md-p">${formatMarkdown(content)}</p>` }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "doubt" && (
          <div className="tab-content chat-tab">
            <div className="tab-header">
              <h2>Ask Doubt</h2>
              <span className="chat-context">Context: {activeExam}</span>
            </div>
            <div className="chat-window">
              {chatMessages.length === 0 && !chatStreaming && (
                <div className="chat-welcome">
                  <div className="chat-avatar">🤖</div>
                  <p>Hi! I'm your {activeExam} AI tutor.</p>
                  <p>Ask me anything about this exam — concepts, formulas, strategy, or doubts!</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble ${msg.role}`}>
                  <div className="bubble-content">{msg.content}</div>
                </div>
              ))}
              {chatStreaming && streamingContent && (
                <div className="chat-bubble assistant streaming">
                  <div className="bubble-content">{streamingContent}<span className="cursor-blink">|</span></div>
                </div>
              )}
              {chatStreaming && !streamingContent && (
                <div className="chat-bubble assistant">
                  <div className="typing-dots">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            >
              <input
                className="chat-input"
                type="text"
                placeholder={`Ask anything about ${activeExam}...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatStreaming}
              />
              <button
                className="send-btn"
                type="submit"
                disabled={!chatInput.trim() || chatStreaming}
              >
                Send
              </button>
            </form>
          </div>
        )}

        {activeTab === "progress" && (
          <div className="tab-content">
            <div className="tab-header">
              <h2>Your Progress</h2>
            </div>
            <div className="progress-hero">
              <div className="accuracy-ring">
                <svg viewBox="0 0 100 100" className="ring-svg">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#1a1a2e" strokeWidth="8" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#e8ff5a"
                    strokeWidth="8"
                    strokeDasharray={`${accuracy * 2.64} ${264 - accuracy * 2.64}`}
                    strokeDashoffset="66"
                    strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 0.5s ease" }}
                  />
                </svg>
                <div className="ring-inner">
                  <span className="ring-pct">{accuracy}%</span>
                  <span className="ring-label">Accuracy</span>
                </div>
              </div>
              <div className="stats-cards">
                <div className="stat-card">
                  <span className="stat-num">{totalAnswered}</span>
                  <span className="stat-label">Questions Attempted</span>
                </div>
                <div className="stat-card correct">
                  <span className="stat-num">{totalCorrect}</span>
                  <span className="stat-label">Correct</span>
                </div>
                <div className="stat-card wrong">
                  <span className="stat-num">{totalAnswered - totalCorrect}</span>
                  <span className="stat-label">Incorrect</span>
                </div>
              </div>
            </div>

            {Object.keys(topicProgress).length > 0 ? (
              <div className="topic-progress">
                <h3>Topic-wise Performance</h3>
                {Object.entries(topicProgress).map(([topic, data]) => {
                  const total = data.correct + data.incorrect;
                  const pct = total > 0 ? Math.round((data.correct / total) * 100) : 0;
                  return (
                    <div key={topic} className="topic-row">
                      <div className="topic-info">
                        <span className="topic-name">{topic}</span>
                        <span className="topic-pct">{pct}%</span>
                      </div>
                      <div className="topic-bar-bg">
                        <div
                          className="topic-bar-fill"
                          style={{ width: `${pct}%`, background: pct >= 70 ? "#e8ff5a" : pct >= 40 ? "#ffa500" : "#ff4d4d" }}
                        />
                      </div>
                      <div className="topic-counts">
                        <span className="tc correct">✓ {data.correct}</span>
                        <span className="tc wrong">✗ {data.incorrect}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📈</div>
                <p>No practice data yet</p>
                <p className="empty-sub">Go to Practice tab and answer some questions to see your progress</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
