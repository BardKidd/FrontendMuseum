/** 外殼進入點。MPA 的 index.html 只掛這一支。 */
import { createRoot } from 'react-dom/client';
import { App } from './App';

const host = document.getElementById('root');
if (!host) throw new Error('#root 不存在');

// 不要 React.StrictMode。dev 模式的 double render 會讓外殼在同一幀跑兩次，
// LoAF 的 script 清單多一份外殼的量、attribution 更容易被判成 mixed（陷阱 #16）。
// 外殼的乾淨程度直接影響歸因，而歸因是 Phase 0 的 G2 目標。
createRoot(host).render(<App />);
