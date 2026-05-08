import { useRef, useState, useEffect } from 'react';
import GlassSurface from './components/GlassSurface/GlassSurface';
import './App.css';

function Draggable({ initial, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(initial);
  const drag = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return;
      const p = e.touches ? e.touches[0] : e;
      setPos({
        x: p.clientX - drag.current.dx,
        y: p.clientY - drag.current.dy,
      });
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    const r = ref.current.getBoundingClientRect();
    drag.current = { dx: p.clientX - r.left, dy: p.clientY - r.top };
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="draggable"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={onDown}
      onTouchStart={onDown}
    >
      {children}
    </div>
  );
}

function App() {
  return (
    <div className="stage">
      <div className="backdrop" />

      <Draggable initial={{ x: 80, y: 120 }}>
        <GlassSurface
          width={260}
          height={72}
          borderRadius={36}
          blur={11}
          distortionScale={-180}
          redOffset={0}
          greenOffset={10}
          blueOffset={20}
        >
          <span className="label">Liquid Pill</span>
        </GlassSurface>
      </Draggable>

      <Draggable initial={{ x: 420, y: 220 }}>
        <GlassSurface
          width={220}
          height={220}
          borderRadius={42}
          blur={11}
          distortionScale={-180}
          redOffset={0}
          greenOffset={10}
          blueOffset={20}
        >
          <span className="label">Rounded Square</span>
        </GlassSurface>
      </Draggable>

      <p className="hint">
        Drag either glass element across the colors to see iOS-style refraction.
        Best in Chrome / Edge — Safari & Firefox fall back to plain blur.
      </p>
    </div>
  );
}

export default App;
