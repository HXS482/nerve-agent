import './laptop-loader.css'

// 思考中的笔记本 loader（纯 CSS/SVG 动画，em 单位，font-size 控制整体缩放）
export function LaptopLoader() {
  return (
    <div className="laptop-loader">
      <div className="lp-aura" />
      <div className="lp-particles">
        <span className="lp-particle" />
        <span className="lp-particle" />
        <span className="lp-particle" />
        <span className="lp-particle" />
        <span className="lp-particle" />
        <span className="lp-particle" />
      </div>
      <div className="lp-scene">
        <div className="lp-laptop">
          <div className="lp-screen">
            <div className="lp-bezel">
              <div className="lp-display">
                <div className="lp-app">
                  <div className="lp-bar">
                    <span className="lp-avatar" />
                    <span className="lp-barlines"><i /><i /></span>
                    <span className="lp-menudots"><i /><i /><i /></span>
                  </div>
                  <div className="lp-chat">
                    <div className="lp-msg lp-msg--in lp-msg--1">
                      <span className="lp-msgtext">hey!</span>
                    </div>
                    <div className="lp-msg lp-msg--out lp-msg--2">
                      <span className="lp-msgtext">hi :)</span>
                    </div>
                    <div className="lp-msg lp-msg--in lp-msg--3 lp-typing">
                      <i /><i /><i />
                    </div>
                  </div>
                  <div className="lp-progress"><i /></div>
                  <div className="lp-input">
                    <span className="lp-field"><span className="lp-typed">hi :)</span><i className="lp-caret" /></span>
                    <i className="lp-send" />
                  </div>
                </div>
              </div>
            </div>
            <div className="lp-cam" />
          </div>
          <div className="lp-hinge" />
          <div className="lp-deck">
            <div className="lp-base">
              <div className="lp-keys">
                <div className="lp-row">
                  <i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key lp-hit lp-k4" />
                </div>
                <div className="lp-row">
                  <i className="lp-key" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key lp-hit lp-k1" /><i className="lp-key" /><i className="lp-key lp-hit lp-k2" /><i className="lp-key" />
                </div>
                <div className="lp-row">
                  <i className="lp-key lp-key--shift lp-shift" /><i className="lp-key" /><i className="lp-key" /><i className="lp-key lp-hit lp-k3" /><i className="lp-key" /><i className="lp-key lp-key--enter lp-hit lp-k6" />
                </div>
                <div className="lp-row">
                  <i className="lp-key" /><i className="lp-key" /><i className="lp-key lp-key--space lp-hit lp-k5" /><i className="lp-key" /><i className="lp-key" />
                </div>
              </div>
              <div className="lp-pad" />
            </div>
            <div className="lp-front" />
          </div>
        </div>
      </div>
      <div className="lp-shadow" />
    </div>
  )
}
