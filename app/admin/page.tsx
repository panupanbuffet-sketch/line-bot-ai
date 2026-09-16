"use client";
import { useState } from "react";

type Conversation = { userId: string; name: string; mode: "bot" | "human" };
export default function Admin() {
  const [token, setToken] = useState("");
  const [users, setUsers] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function request(method: string, body?: unknown) {
    const response = await fetch("/api/bot-admin", {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(response.status === 401 ? "รหัสผู้ดูแลไม่ถูกต้องหรือยังไม่ได้ตั้งค่า" : "ติดต่อระบบสถานะไม่ได้ กรุณาตรวจการตั้งค่า");
    return response.json();
  }
  async function refresh() {
    setBusy(true); setMessage("");
    try { setUsers((await request("GET")).conversations); setMessage("โหลดรายชื่อล่าสุดแล้ว"); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function change(userId: string, mode: "bot" | "human") {
    setBusy(true); setMessage("");
    try {
      await request("POST", { userId, mode });
      setUsers(users.map(user => user.userId === userId ? { ...user, mode } : user));
      setMessage(mode === "human" ? "พักบอตแล้ว เปิด LINE OA เพื่อคุยกับลูกค้าได้" : "คืนงานให้บอตแล้ว บอตจะตอบเมื่อมีข้อความใหม่");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 800, margin: "48px auto", padding: 24, fontFamily: "sans-serif", lineHeight: 1.7 }}>
    <h1>TASANA · ดูแลแชต</h1>
    <p>กดพักบอตก่อนตอบลูกค้าใน LINE OA และกดคืนงานเมื่อจบการสนทนา การพิมพ์ใน LINE OA อย่างเดียวไม่ได้พักบอต</p>
    <label>รหัสผู้ดูแล <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>{" "}
    <button disabled={busy || !token} onClick={refresh}>โหลดรายชื่อ</button>{" "}
    <button onClick={() => { setToken(""); setUsers([]); setMessage(""); }}>ออกจากหน้านี้</button>
    <p>รหัสใช้เฉพาะในหน้านี้ ไม่บันทึกลงเบราว์เซอร์ · แสดงผู้ติดต่อ 20 คนล่าสุด</p>
    <p role="status">{message}</p>
    <a href="https://chat.line.biz/account/@409xrtpd" target="_blank" rel="noreferrer">เปิดแชต LINE OA</a>
    {users.map(user => <section key={user.userId} style={{ borderTop: "1px solid #ccc", padding: "20px 0" }}>
      <strong>{user.name}</strong><br/><small>{user.userId}</small>
      <p>{user.mode === "human" ? "เจ้าหน้าที่ดูแล · บอตพักอยู่" : "บอตพร้อมตอบ"}</p>
      <button disabled={busy || user.mode === "human"} onClick={() => change(user.userId, "human")}>รับช่วง / พักบอต</button>{" "}
      <button disabled={busy || user.mode === "bot"} onClick={() => change(user.userId, "bot")}>คืนงานให้บอต</button>
    </section>)}
  </main>;
}
