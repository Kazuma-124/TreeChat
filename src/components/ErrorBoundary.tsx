import { Component, ReactNode } from 'react';

// 兜底错误边界：捕获渲染期异常，避免整页白屏（此前曾因数据异常直接白屏）。
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('页面渲染出错：', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>页面渲染出错</h2>
          <p>{this.state.error.message}</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}
