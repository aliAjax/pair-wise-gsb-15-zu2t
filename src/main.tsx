import React from 'react';import ReactDOM from 'react-dom/client';import App from './App';import './styles.css';import {useAppStore} from './store/useAppStore';
// 暴露 store 便于端到端测试模拟第二客户端的图编辑操作
(window as any).__appStore=useAppStore;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
