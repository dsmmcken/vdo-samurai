import { useRef, useEffect, useState, useCallback } from 'react';

interface Petal {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  velocityX: number;
  velocityY: number;
  swayPhase: number;
  swayAmplitude: number;
  swayFrequency: number;
  color: string;
  opacity: number;
  fadeState: 'active' | 'fading';
}

interface CherryBlossomButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  containerClassName?: string;
}

const MAX_PETALS = 25;
const SPAWN_RATE = 0.15;

function generatePetalColor(): string {
  // Base: #B1382F -> HSL roughly (5, 59%, 44%)
  const hue = 5 + (Math.random() - 0.5) * 10;
  const sat = 55 + Math.random() * 15;
  const light = 40 + Math.random() * 15;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function createPetal(canvasWidth: number): Petal {
  return {
    x: Math.random() * canvasWidth,
    y: -10,
    size: 6 + Math.random() * 6,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.05,
    velocityX: (Math.random() - 0.5) * 0.3,
    velocityY: 0.5 + Math.random() * 0.5,
    swayPhase: Math.random() * Math.PI * 2,
    swayAmplitude: 0.3 + Math.random() * 0.4,
    swayFrequency: 0.02 + Math.random() * 0.02,
    color: generatePetalColor(),
    opacity: 0.7 + Math.random() * 0.3,
    fadeState: 'active',
  };
}

function drawPetal(ctx: CanvasRenderingContext2D, petal: Petal): void {
  const { x, y, size, rotation, color, opacity } = petal;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;

  // Draw cherry blossom petal: elongated teardrop with notch at wide end
  const length = size * 1.2;
  const width = size * 0.7;

  ctx.beginPath();
  // Start at the narrow tip (stem end)
  ctx.moveTo(0, -length * 0.5);

  // Right curve from tip to wide end
  ctx.bezierCurveTo(
    width * 0.5,
    -length * 0.3,
    width * 0.6,
    length * 0.2,
    width * 0.25,
    length * 0.45
  );

  // Notch at the wide end (characteristic of cherry blossom petals)
  ctx.quadraticCurveTo(0, length * 0.35, -width * 0.25, length * 0.45);

  // Left curve back to tip
  ctx.bezierCurveTo(
    -width * 0.6,
    length * 0.2,
    -width * 0.5,
    -length * 0.3,
    0,
    -length * 0.5
  );

  ctx.fill();

  ctx.restore();
}

function updatePetal(
  petal: Petal,
  deltaTime: number,
  canvasHeight: number,
  canvasWidth: number,
  isActive: boolean,
  windX: number // -1 to 1, based on mouse position
): boolean {
  const dt = deltaTime / 16.67;

  // Vertical drift
  petal.y += petal.velocityY * dt;

  // Horizontal sway + wind influence
  petal.swayPhase += petal.swayFrequency * dt;
  petal.x += Math.sin(petal.swayPhase) * petal.swayAmplitude * dt;
  petal.x += petal.velocityX * dt;
  petal.x += windX * 0.5 * dt; // Wind from mouse position

  // Rotation influenced by wind
  petal.rotation += (petal.rotationSpeed + windX * 0.02) * dt;

  // Handle fading
  if (!isActive && petal.fadeState === 'active') {
    petal.fadeState = 'fading';
  }

  if (petal.fadeState === 'fading') {
    petal.opacity -= 0.02 * dt;
  }

  // Remove if off-screen or fully faded
  return petal.y < canvasHeight + 20 && petal.x > -20 && petal.x < canvasWidth + 20 && petal.opacity > 0;
}

export function CherryBlossomButton({
  children,
  className = '',
  containerClassName = '',
  ...props
}: CherryBlossomButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const petalsRef = useRef<Petal[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const dimensionsRef = useRef({ width: 0, height: 0 });

  const [isHovering, setIsHovering] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const mousePositionRef = useRef({ x: 0.5, y: 0.5 }); // Normalized 0-1, 0.5 = center

  // Handle canvas sizing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const { width, height } = rect;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      dimensionsRef.current = { width, height };

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    if (!isAnimating) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const animate = (timestamp: number) => {
      const deltaTime = lastTimeRef.current
        ? timestamp - lastTimeRef.current
        : 16.67;
      lastTimeRef.current = timestamp;

      const { width, height } = dimensionsRef.current;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Spawn new petals while hovering
      if (isHovering && petalsRef.current.length < MAX_PETALS) {
        if (Math.random() < SPAWN_RATE) {
          petalsRef.current.push(createPetal(width));
        }
      }

      // Calculate wind from mouse position (-1 to 1)
      const windX = (mousePositionRef.current.x - 0.5) * 2;

      // Update and render petals
      petalsRef.current = petalsRef.current.filter((petal) => {
        const alive = updatePetal(petal, deltaTime, height, width, isHovering, windX);
        if (alive) {
          drawPetal(ctx, petal);
        }
        return alive;
      });

      // Stop animation when no petals remain and not hovering
      if (!isHovering && petalsRef.current.length === 0) {
        setIsAnimating(false);
        lastTimeRef.current = 0;
        return;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isAnimating, isHovering]);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    setIsAnimating(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    mousePositionRef.current = { x: 0.5, y: 0.5 }; // Reset to center
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    mousePositionRef.current = { x, y };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${containerClassName}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      <button className={`relative overflow-hidden ${className}`} {...props}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none z-0"
          aria-hidden="true"
        />
        <span className="relative z-10">{children}</span>
      </button>
    </div>
  );
}
