// Sandbox <-> Production toggle. Phase 0: cosmetic (no backend env wiring yet); Production asks
// for a confirm to model the heightened guardrail it'll carry once writes exist.
export default function EnvSwitch({ env, setEnv }) {
  return (
    <div className="envswitch" role="group" aria-label="Environment">
      <button
        className={env === 'sandbox' ? 'seg active' : 'seg'}
        onClick={() => setEnv('sandbox')}
      >
        Sandbox
      </button>
      <button
        className={env === 'production' ? 'seg active danger' : 'seg'}
        onClick={() => { if (window.confirm('Switch to PRODUCTION?')) setEnv('production'); }}
      >
        Production
      </button>
    </div>
  );
}
