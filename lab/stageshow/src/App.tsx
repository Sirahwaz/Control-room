import { useState } from 'react'
import { Stage } from './upstream/kit/stage'

type Scene = { phase: 'ready' | 'scanning' | 'verified' }

export default function App() {
  const [replay, setReplay] = useState(0)
  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="#home" aria-label="MIDAD Lab home"><span className="mark">M</span><span>MIDAD <b>LAB</b></span></a>
        <span className="environment"><i /> ISOLATED VISUAL ENVIRONMENT</span>
      </header>
      <section className="intro">
        <p className="eyebrow">REVERSE ENGINEERING LAB / VISUAL FACTORY</p>
        <h1>Make complex systems <em>understandable.</em></h1>
        <p className="subhead">A StageShow runtime proof-of-concept, using original MIDAD sample data and the pinned upstream motion engine.</p>
      </section>
      <section className="demo-panel" aria-label="StageShow visual demo">
        <div className="panel-heading">
          <div><span className="eyebrow">LIVE SCENE / SAMPLE ONLY</span><h2>Evidence review workflow</h2></div>
          <span className="demo-stamp">ILLUSTRATIVE DEMO</span>
        </div>
        <Stage<Scene>
          key={replay}
          width={1040}
          height={490}
          compact={{ below: 560, width: 390, height: 540 }}
          initial={{ phase: 'ready' }}
          poster={{ phase: 'verified' }}
          play="once"
          cursor={{ at: 'scan', style: 'large', ripple: true, idle: 1600 }}
          script={async (act) => {
            await act.wait(450)
            await act.move('scan', { duration: 650 })
            await act.click('scan')
            await act.set({ phase: 'scanning' })
            await act.wait(900)
            await act.set({ phase: 'verified' })
          }}
        >
          {(scene) => (
            <div className="scene">
              <aside className="scene-rail">
                <div className="rail-logo">M</div>
                <span className="rail-active">⌂</span><span>⌘</span><span>◫</span><span>⚙</span>
                <div className="rail-bottom">S</div>
              </aside>
              <div className="scene-main">
                <div className="scene-nav"><span>Workspace / <b>Evidence review</b></span><span className="avatar">M</span></div>
                <div className="scene-title"><div><small>ANALYSIS SESSION / #0042</small><h3>Mobile app inspection</h3></div><span className="neutral-pill">READ-ONLY</span></div>
                <div className="scene-grid">
                  <article className="evidence-card">
                    <div className="card-top"><span>01 / PACKAGE METADATA</span><span className="tiny-dot" /></div>
                    <div className="app-icon">◎</div>
                    <h4>Sample application</h4><p>com.example.sample</p>
                    <div className="meta-line"><span>Package</span><b>Android / APK</b></div>
                    <div className="meta-line"><span>Source</span><b>Local fixture</b></div>
                    <div className="meta-line"><span>Scope</span><b>Static review</b></div>
                  </article>
                  <article className="review-card">
                    <div className="card-top"><span>02 / INSPECTION PIPELINE</span><span className="neutral-pill">SIMULATED</span></div>
                    <div className="pipeline">
                      <div className="pipeline-row done"><i>✓</i><span><b>Manifest parsed</b><small>Permissions and components</small></span><strong>DONE</strong></div>
                      <div className={scene.phase === 'ready' ? 'pipeline-row' : 'pipeline-row done'}><i>{scene.phase === 'ready' ? '2' : '✓'}</i><span><b>Evidence correlated</b><small>Resources and entry points</small></span><strong>{scene.phase === 'ready' ? 'WAITING' : 'DONE'}</strong></div>
                      <div className={scene.phase === 'verified' ? 'pipeline-row done' : 'pipeline-row'}><i>{scene.phase === 'verified' ? '✓' : '3'}</i><span><b>Review package</b><small>Findings prepared for review</small></span><strong>{scene.phase === 'verified' ? 'READY' : 'PENDING'}</strong></div>
                    </div>
                    <button className="scan-button" data-target="scan" aria-label="Run visual walkthrough" type="button">{scene.phase === 'verified' ? 'Review prepared' : scene.phase === 'scanning' ? 'Correlating evidence…' : 'Inspect sample'} <span>↗</span></button>
                  </article>
                  <article className="result-card">
                    <div className="card-top"><span>03 / SESSION STATUS</span></div>
                    <div className="result-number">{scene.phase === 'verified' ? '03' : scene.phase === 'scanning' ? '02' : '01'}</div>
                    <p>{scene.phase === 'verified' ? 'Review prepared' : scene.phase === 'scanning' ? 'Evidence correlation' : 'Awaiting inspection'}</p>
                    <div className="result-rule" />
                    <small>DEMO STATE ONLY</small>
                  </article>
                </div>
                <div className="scene-footer"><span>NO NETWORK / NO BACKEND / NO ACCOUNT ACCESS</span><span>VISUAL STATE: {scene.phase.toUpperCase()}</span></div>
              </div>
            </div>
          )}
        </Stage>
        <div className="panel-footer"><span>StageShow engine · upstream revision 8020574</span><button onClick={() => setReplay((n) => n + 1)} type="button">↻ Replay walkthrough</button></div>
      </section>
      <footer className="page-footer"><span>MIDAD AI · INTELLIGENCE & AUTOMATION</span><span>DEMO DATA — NOT OPERATIONAL EVIDENCE</span></footer>
    </main>
  )
}
