import { aiReplies, defaultReply } from '../store.js';

let chatBodyEl = null;

const quickQuestions = [
  { icon: '💰', label: '拖欠工资', text: '我被拖欠工资3个月了' },
  { icon: '❌', label: '违法辞退', text: '公司违法辞退我' },
  { icon: '⏰', label: '加班费',   text: '我有大量加班费没拿到' },
  { icon: '🏥', label: '工伤认定', text: '工伤如何认定' },
];

function getReply(text) {
  for (const [key, reply] of Object.entries(aiReplies)) {
    if (text.includes(key)) return reply;
  }
  return defaultReply;
}

function addMessage(text, isUser) {
  const div = document.createElement('div');
  div.className = `msg ${isUser ? 'msg-user' : 'msg-ai'}`;
  const avatar = `<div class="msg-avatar">${isUser ? '👤' : '⚖️'}</div>`;
  const formatted = text.replace(/\n/g, '<br>');
  const bubble = `<div class="msg-bubble">${formatted}</div>`;
  div.innerHTML = isUser ? bubble + avatar : avatar + bubble;
  chatBodyEl.appendChild(div);
  chatBodyEl.scrollTop = chatBodyEl.scrollHeight;
}

function sendMessage(text) {
  if (!text?.trim()) return;
  addMessage(text, true);
  setTimeout(() => addMessage(getReply(text), false), 800);
}

export function render() {
  return `
  <div class="page">
    <div class="chat-header">
      <h3>🤖 AI 法律顾问</h3>
      <p>专业劳动法AI · 7×24小时在线</p>
    </div>
    <div class="chat-body" id="chat-body">
      <div class="msg msg-ai">
        <div class="msg-avatar">⚖️</div>
        <div class="msg-bubble">
          你好！我是安薪乐业AI法律顾问，专注于劳动权益保护。<br><br>
          请告诉我你遇到的情况，我来帮你分析权益和维权路径。比如：<strong>欠薪、违法辞退、加班费、工伤认定</strong>等问题。
        </div>
      </div>
    </div>
    <div class="chat-quick" id="chat-quick">
      ${quickQuestions.map(q => `
        <div class="chat-quick-btn" data-text="${q.text}">${q.icon} ${q.label}</div>
      `).join('')}
    </div>
    <div class="chat-input-row">
      <input class="chat-input" id="chat-input" placeholder="输入你的问题…">
      <button class="chat-send" id="chat-send">发送</button>
    </div>
  </div>`;
}

export function mount() {
  chatBodyEl = document.getElementById('chat-body');
  const input = document.getElementById('chat-input');

  document.getElementById('chat-send').addEventListener('click', () => {
    sendMessage(input.value.trim());
    input.value = '';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      sendMessage(input.value.trim());
      input.value = '';
    }
  });

  document.getElementById('chat-quick').addEventListener('click', e => {
    const btn = e.target.closest('.chat-quick-btn');
    if (btn) sendMessage(btn.dataset.text);
  });
}

export function destroy() {
  chatBodyEl = null;
}
