"use client";

import { apiUrl } from "@/lib/api";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Play,
  Square,
  TimerReset,
  UserCheck,
} from "lucide-react";
import CameraCapture, { CapturedFaceBox, FaceData } from "../../components/CameraCapture";

export default function EntryExitAttendancePage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [exitOpensAt, setExitOpensAt] = useState<string | null>(null);
  const [exitPhaseOpen, setExitPhaseOpen] = useState(false);
  const [exitSecondsRemaining, setExitSecondsRemaining] = useState<number | null>(null);
  const [pendingExitCount, setPendingExitCount] = useState(0);
  const [recognitionStarted, setRecognitionStarted] = useState(false);
  const [markType, setMarkType] = useState<"entry" | "exit">("entry");
  const [status, setStatus] = useState("Create a session to begin entry/exit attendance.");
  const [facesData, setFacesData] = useState<FaceData[]>([]);
  const [lastResult, setLastResult] = useState<string[]>([]);
  const [form, setForm] = useState({
    date: "",
    subject: "",
    department: "",
    year: "",
    division: "",
    exit_timer_minutes: "15",
  });

  const departments = ["Computer Science", "IT", "Electronics", "Mechanical", "Civil"];
  const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
  const divisions = ["A", "B", "C", "D"];

  useEffect(() => {
    if (!exitOpensAt || exitPhaseOpen || sessionEnded) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(exitOpensAt) - Date.now()) / 1000));
      setExitSecondsRemaining(remaining);
      if (remaining === 0) {
        setExitPhaseOpen(true);
        setMarkType("exit");
        setStatus("Entry is closed. Exit attendance is now open.");
      }
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(intervalId);
  }, [exitOpensAt, exitPhaseOpen, sessionEnded]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const createSession = async () => {
    if (!form.date || !form.subject || !form.department || !form.year || !form.division) {
      setStatus("Please fill all session fields before creating the session.");
      return;
    }

    try {
      setStatus("Creating session...");
      const res = await fetch(apiUrl("/api/attendance/create_session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          exit_timer_minutes: Number(form.exit_timer_minutes || 0),
        }),
      });

      const data = await res.json();
      if (data.session_id) {
        setSessionId(data.session_id);
        setExitOpensAt(data.exit_opens_at || null);
        setExitPhaseOpen(false);
        setExitSecondsRemaining(data.exit_opens_at ? Number(form.exit_timer_minutes || 0) * 60 : null);
        setPendingExitCount(0);
        setMarkType("entry");
        setStatus(data.exit_opens_at
          ? `Session created. Entry is open; exit opens in ${Number(form.exit_timer_minutes || 0)} minutes.`
          : "Session created. Entry is open until the teacher enables exit.");
      } else {
        setStatus("❌ Unable to create the session.");
      }
    } catch (error) {
      console.error(error);
      setStatus("❌ Session creation failed.");
    }
  };

  const handleRecognize = async (imageDataUrl: string, faceBoxes: CapturedFaceBox[]) => {
    if (!sessionId || sessionEnded) {
      setStatus("Please create a session before marking attendance.");
      return;
    }

    try {
      setStatus(`Marking ${markType} attendance...`);
      const res = await fetch(apiUrl("/api/attendance/mark_entry_exit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageDataUrl,
          face_boxes: faceBoxes,
          session_id: sessionId,
          mark_type: markType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`❌ ${data.error || "Attendance request rejected."}`);
        return;
      }

      if (data.session_progress) setPendingExitCount(data.session_progress.pending_exit_count);
      if (data.session_ended) {
        setRecognitionStarted(false);
        setSessionEnded(true);
        setStatus(`✅ All exits recorded. Session ended with ${data.statistics.present_count} present and ${data.statistics.absent_count} absent.`);
        return;
      }

      if (data.faces && data.faces.length > 0) {
        const detected = data.faces[0];
        const message = detected.message || "Attendance processed.";
        const label = detected.status || "processed";

        setFacesData(data.faces.map((f: FaceData) => ({ box: f.box, match: f.match })));
        setLastResult((prev) => [message, ...prev].slice(0, 5));

        if (detected.match) {
          setStatus(`✅ ${detected.match.name} marked as ${markType}.`);
        } else if (label === "timeout") {
          setStatus("⚠️ Exit was outside the teacher-defined timer window.");
        } else if (label === "duplicate") {
          setStatus("⚠️ This attendance has already been marked.");
        } else {
          setStatus(`❌ ${message}`);
        }
      } else {
        setStatus("❌ No face was detected in the camera frame.");
        setFacesData([]);
      }
    } catch (error) {
      console.error(error);
      setStatus("❌ Recognition request failed.");
    }
  };

  const enableExitPhase = async () => {
    if (!sessionId || sessionEnded || exitPhaseOpen) return;

    try {
      const res = await fetch(apiUrl("/api/attendance/enable_exit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus(`❌ ${data.error || "Unable to open exit attendance."}`);
        return;
      }

      setExitPhaseOpen(true);
      setExitOpensAt(null);
      setExitSecondsRemaining(0);
      setMarkType("exit");
      setStatus("Entry is closed. Exit attendance is now open.");
    } catch (error) {
      console.error(error);
      setStatus("❌ Could not open the exit phase.");
    }
  };

  const endSession = async () => {
    if (!sessionId || sessionEnded) return;

    try {
      setStatus("Ending session...");
      const res = await fetch(apiUrl("/api/attendance/end_session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.session_progress) setPendingExitCount(data.session_progress.pending_exit_count);
        setStatus(`❌ ${data.error || "Unable to end session."}`);
        return;
      }

      setRecognitionStarted(false);
      setSessionEnded(true);
      setStatus(`✅ Session ended. ${data.statistics.present_count} present, ${data.statistics.absent_count} absent.`);
    } catch (error) {
      console.error(error);
      setStatus("❌ Failed to end session.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50 to-orange-50">
      <header className="bg-white/80 border-b border-slate-200 backdrop-blur-lg">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/teacher/dashboard")}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-r from-rose-100 to-pink-100">
                <Clock3 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Entry & Exit Attendance</h1>
                <p className="text-sm text-slate-600">Teacher-controlled entry and exit face marking</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-sm text-slate-700 border border-slate-200">
            <TimerReset className="w-4 h-4" />
            {sessionEnded ? "Session ended" : sessionId ? "Session ready" : "No session"}
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="bg-white/70 rounded-2xl border border-slate-200 shadow-lg p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-r from-blue-100 to-cyan-100">
                <GraduationCap className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Session Setup</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-700 mb-1 block font-medium">Date</label>
                <input type="date" name="date" value={form.date} onChange={handleChange} className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }} />
              </div>
              <div>
                <label className="text-sm text-slate-700 mb-1 block font-medium">Subject</label>
                <input type="text" name="subject" value={form.subject} onChange={handleChange} placeholder="Enter subject" className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-700 mb-1 block font-medium">Department</label>
                  <select name="department" value={form.department} onChange={handleChange} className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }}>
                    <option value="">Select</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-slate-700 mb-1 block font-medium">Year</label>
                  <select name="year" value={form.year} onChange={handleChange} className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }}>
                    <option value="">Select</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-700 mb-1 block font-medium">Division</label>
                  <select name="division" value={form.division} onChange={handleChange} className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }}>
                    <option value="">Select</option>
                    {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-slate-700 mb-1 block font-medium">Exit timer (min)</label>
                  <input type="number" min="0" step="5" name="exit_timer_minutes" value={form.exit_timer_minutes} onChange={handleChange} className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400" style={{ colorScheme: "light" }} />
                </div>
              </div>

              <button
                onClick={createSession}
                className="w-full py-3 rounded-lg font-semibold bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-600 hover:to-green-600 transition-all"
              >
                Create Session
              </button>
            </div>
          </div>

          <div className="bg-white/70 rounded-2xl border border-slate-200 shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-r from-violet-100 to-indigo-100">
                  <Camera className="w-5 h-5 text-violet-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-800">Recognition</h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setMarkType("entry")}
                  disabled={exitPhaseOpen || sessionEnded}
                  className={`px-4 py-2 rounded-lg font-medium ${markType === "entry" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Entry
                </button>
                <button
                  onClick={() => setMarkType("exit")}
                  disabled={!exitPhaseOpen || sessionEnded}
                  className={`px-4 py-2 rounded-lg font-medium ${markType === "exit" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700"} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Exit
                </button>
              </div>
            </div>

            {!sessionId ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
                Create a session first to mark face attendance.
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  {exitPhaseOpen
                    ? `Exit phase is open. ${pendingExitCount} student(s) with recorded entry still need to scan out.`
                    : exitSecondsRemaining !== null
                      ? `Entry phase is open. Exit attendance unlocks in ${Math.floor(exitSecondsRemaining / 60)}:${String(exitSecondsRemaining % 60).padStart(2, "0")}.`
                      : "Entry phase is open. The teacher can enable exit when entry is complete."}
                </div>

                {sessionEnded ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center font-medium text-emerald-800">
                    This attendance session has ended.
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex gap-3">
                      <button
                        onClick={() => setRecognitionStarted(true)}
                        className="flex-1 py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4" /> Start Camera
                      </button>
                      <button
                        onClick={() => setRecognitionStarted(false)}
                        className="flex-1 py-3 rounded-lg bg-slate-200 text-slate-700 font-semibold hover:bg-slate-300 flex items-center justify-center gap-2"
                      >
                        <Square className="w-4 h-4" /> Stop
                      </button>
                    </div>

                    {!exitPhaseOpen && (
                      <button
                        onClick={enableExitPhase}
                        className="mb-4 w-full py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700"
                      >
                        End Entry and Enable Exit
                      </button>
                    )}

                    <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                      <CameraCapture
                        isLiveMode={recognitionStarted}
                        onCapture={handleRecognize}
                        facesData={facesData}
                        captureIntervalMs={4000}
                      />
                    </div>
                    <button
                      onClick={endSession}
                      disabled={!exitPhaseOpen || pendingExitCount > 0}
                      className="mt-4 w-full py-3 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      <Square className="w-4 h-4" /> {pendingExitCount > 0 ? `Waiting for ${pendingExitCount} exit scan(s)` : "End Session"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white/70 rounded-2xl border border-slate-200 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-gradient-to-r from-emerald-100 to-green-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Status</h2>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 font-medium">{status}</div>
          </div>

          <div className="bg-white/70 rounded-2xl border border-slate-200 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-gradient-to-r from-amber-100 to-yellow-100">
                <UserCheck className="w-5 h-5 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Recent results</h2>
            </div>
            <div className="space-y-2">
              {lastResult.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-slate-500 text-sm">No results yet.</div>
              ) : (
                lastResult.map((item, index) => (
                  <div key={`${item}-${index}`} className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
                    {item}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
