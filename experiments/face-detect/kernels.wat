;; SIMD inner loops for blazeface.js. All pointers are byte offsets into the
;; shared memory; tensors are NHWC float32. Build: node build-wasm.mjs

(module
  (import "env" "mem" (memory 1))

  ;; 1x1 convolution: y[p][o] = b[o] + sum_c x[p][c] * w[c][o]
  ;; w is transposed to [C][O4] (O rounded up to a multiple of 4) so four
  ;; outputs load as one vector, and two pixels share each weight load. A
  ;; final partial block stores only its valid lanes. Needs P even.
  (func (export "pointwise")
    (param $x i32) (param $P i32) (param $C i32) (param $w i32) (param $O i32) (param $b i32) (param $y i32) (param $relu i32)
    (local $p i32) (local $o i32) (local $c i32)
    (local $xa i32) (local $xb i32) (local $ya i32) (local $yb i32) (local $wp i32)
    (local $rowC i32) (local $rowO i32) (local $end i32) (local $wrow i32) (local $left i32)
    (local $a v128) (local $bb v128) (local $k v128)
    (local.set $rowC (i32.shl (local.get $C) (i32.const 2)))
    (local.set $rowO (i32.shl (local.get $O) (i32.const 2)))
    (local.set $wrow (i32.shl (i32.and (i32.add (local.get $O) (i32.const 3)) (i32.const -4)) (i32.const 2)))
    (block $pdone
      (loop $ploop
        (br_if $pdone (i32.ge_u (local.get $p) (local.get $P)))
        (local.set $xa (i32.add (local.get $x) (i32.mul (local.get $p) (local.get $rowC))))
        (local.set $xb (i32.add (local.get $xa) (local.get $rowC)))
        (local.set $ya (i32.add (local.get $y) (i32.mul (local.get $p) (local.get $rowO))))
        (local.set $yb (i32.add (local.get $ya) (local.get $rowO)))
        (local.set $o (i32.const 0))
        (block $odone
          (loop $oloop
            (br_if $odone (i32.ge_u (local.get $o) (local.get $rowO)))
            (local.set $a (v128.load (i32.add (local.get $b) (local.get $o))))
            (local.set $bb (local.get $a))
            (local.set $wp (i32.add (local.get $w) (local.get $o)))
            (local.set $c (i32.const 0))
            (local.set $end (local.get $rowC))
            (block $cdone
              (loop $cloop
                (br_if $cdone (i32.ge_u (local.get $c) (local.get $end)))
                (local.set $k (v128.load (local.get $wp)))
                (local.set $a (f32x4.add (local.get $a)
                  (f32x4.mul (f32x4.splat (f32.load (i32.add (local.get $xa) (local.get $c)))) (local.get $k))))
                (local.set $bb (f32x4.add (local.get $bb)
                  (f32x4.mul (f32x4.splat (f32.load (i32.add (local.get $xb) (local.get $c)))) (local.get $k))))
                (local.set $wp (i32.add (local.get $wp) (local.get $wrow)))
                (local.set $c (i32.add (local.get $c) (i32.const 4)))
                (br $cloop)))
            (if (local.get $relu)
              (then
                (local.set $a (f32x4.max (local.get $a) (v128.const f32x4 0 0 0 0)))
                (local.set $bb (f32x4.max (local.get $bb) (v128.const f32x4 0 0 0 0)))))
            (local.set $left (i32.sub (local.get $rowO) (local.get $o)))
            (if (i32.ge_u (local.get $left) (i32.const 16))
              (then
                (v128.store (i32.add (local.get $ya) (local.get $o)) (local.get $a))
                (v128.store (i32.add (local.get $yb) (local.get $o)) (local.get $bb)))
              (else
                ;; 1-3 outputs left (bias and weights past O are ignored lanes)
                (f32.store (i32.add (local.get $ya) (local.get $o)) (f32x4.extract_lane 0 (local.get $a)))
                (f32.store (i32.add (local.get $yb) (local.get $o)) (f32x4.extract_lane 0 (local.get $bb)))
                (if (i32.ge_u (local.get $left) (i32.const 8))
                  (then
                    (f32.store offset=4 (i32.add (local.get $ya) (local.get $o)) (f32x4.extract_lane 1 (local.get $a)))
                    (f32.store offset=4 (i32.add (local.get $yb) (local.get $o)) (f32x4.extract_lane 1 (local.get $bb)))))
                (if (i32.ge_u (local.get $left) (i32.const 12))
                  (then
                    (f32.store offset=8 (i32.add (local.get $ya) (local.get $o)) (f32x4.extract_lane 2 (local.get $a)))
                    (f32.store offset=8 (i32.add (local.get $yb) (local.get $o)) (f32x4.extract_lane 2 (local.get $bb)))))))
            (local.set $o (i32.add (local.get $o) (i32.const 16)))
            (br $oloop)))
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (br $ploop))))

  ;; 3x3 depthwise convolution with TensorFlow "SAME" padding (pt/pl rows and
  ;; columns before). Four channels per vector, scalar for any leftover.
  (func (export "depthwise")
    (param $x i32) (param $H i32) (param $W i32) (param $C i32) (param $w i32) (param $b i32)
    (param $y i32) (param $OH i32) (param $OW i32) (param $s i32) (param $pt i32) (param $pl i32) (param $relu i32)
    (local $oy i32) (local $ox i32) (local $ky i32) (local $kx i32) (local $iy i32) (local $ix i32)
    (local $c i32) (local $yo i32) (local $xo i32) (local $wo i32) (local $rowC i32) (local $vecEnd i32)
    (local.set $rowC (i32.shl (local.get $C) (i32.const 2)))
    (local.set $vecEnd (i32.shl (i32.and (local.get $C) (i32.const -4)) (i32.const 2)))
    (local.set $oy (i32.const 0))
    (loop $yl
      (local.set $ox (i32.const 0))
      (loop $xl
        (local.set $yo (i32.add (local.get $y)
          (i32.mul (i32.add (i32.mul (local.get $oy) (local.get $OW)) (local.get $ox)) (local.get $rowC))))
        (memory.copy (local.get $yo) (local.get $b) (local.get $rowC))
        (local.set $ky (i32.const 0))
        (loop $kyl
          (local.set $iy (i32.add (i32.sub (i32.mul (local.get $oy) (local.get $s)) (local.get $pt)) (local.get $ky)))
          (if (i32.and (i32.ge_s (local.get $iy) (i32.const 0)) (i32.lt_s (local.get $iy) (local.get $H)))
            (then
              (local.set $kx (i32.const 0))
              (loop $kxl
                (local.set $ix (i32.add (i32.sub (i32.mul (local.get $ox) (local.get $s)) (local.get $pl)) (local.get $kx)))
                (if (i32.and (i32.ge_s (local.get $ix) (i32.const 0)) (i32.lt_s (local.get $ix) (local.get $W)))
                  (then
                    (local.set $xo (i32.add (local.get $x)
                      (i32.mul (i32.add (i32.mul (local.get $iy) (local.get $W)) (local.get $ix)) (local.get $rowC))))
                    (local.set $wo (i32.add (local.get $w)
                      (i32.mul (i32.add (i32.mul (local.get $ky) (i32.const 3)) (local.get $kx)) (local.get $rowC))))
                    (local.set $c (i32.const 0))
                    (block $vd
                      (loop $vl
                        (br_if $vd (i32.ge_u (local.get $c) (local.get $vecEnd)))
                        (v128.store (i32.add (local.get $yo) (local.get $c))
                          (f32x4.add (v128.load (i32.add (local.get $yo) (local.get $c)))
                            (f32x4.mul (v128.load (i32.add (local.get $xo) (local.get $c)))
                                       (v128.load (i32.add (local.get $wo) (local.get $c))))))
                        (local.set $c (i32.add (local.get $c) (i32.const 16)))
                        (br $vl)))
                    (block $sd
                      (loop $sl
                        (br_if $sd (i32.ge_u (local.get $c) (local.get $rowC)))
                        (f32.store (i32.add (local.get $yo) (local.get $c))
                          (f32.add (f32.load (i32.add (local.get $yo) (local.get $c)))
                            (f32.mul (f32.load (i32.add (local.get $xo) (local.get $c)))
                                     (f32.load (i32.add (local.get $wo) (local.get $c))))))
                        (local.set $c (i32.add (local.get $c) (i32.const 4)))
                        (br $sl)))))
                (local.set $kx (i32.add (local.get $kx) (i32.const 1)))
                (br_if $kxl (i32.lt_u (local.get $kx) (i32.const 3))))))
          (local.set $ky (i32.add (local.get $ky) (i32.const 1)))
          (br_if $kyl (i32.lt_u (local.get $ky) (i32.const 3))))
        (if (local.get $relu)
          (then
            (local.set $c (i32.const 0))
            (block $rd
              (loop $rl
                (br_if $rd (i32.ge_u (local.get $c) (local.get $rowC)))
                (f32.store (i32.add (local.get $yo) (local.get $c))
                  (f32.max (f32.load (i32.add (local.get $yo) (local.get $c))) (f32.const 0)))
                (local.set $c (i32.add (local.get $c) (i32.const 4)))
                (br $rl)))))
        (local.set $ox (i32.add (local.get $ox) (i32.const 1)))
        (br_if $xl (i32.lt_u (local.get $ox) (local.get $OW))))
      (local.set $oy (i32.add (local.get $oy) (i32.const 1)))
      (br_if $yl (i32.lt_u (local.get $oy) (local.get $OH)))))

  ;; 2x2 max pool, stride 2, over an H x W x C map with even H and W (so
  ;; "SAME" padding adds nothing).
  (func (export "maxpool2") (param $x i32) (param $H i32) (param $W i32) (param $C i32) (param $y i32)
    (local $oy i32) (local $ox i32) (local $c i32) (local $rowC i32) (local $vecEnd i32)
    (local $p00 i32) (local $p01 i32) (local $p10 i32) (local $p11 i32)
    (local.set $rowC (i32.shl (local.get $C) (i32.const 2)))
    (local.set $vecEnd (i32.shl (i32.and (local.get $C) (i32.const -4)) (i32.const 2)))
    (loop $yl
      (local.set $ox (i32.const 0))
      (loop $xl
        (local.set $p00 (i32.add (local.get $x)
          (i32.mul (i32.add (i32.mul (i32.shl (local.get $oy) (i32.const 1)) (local.get $W)) (i32.shl (local.get $ox) (i32.const 1))) (local.get $rowC))))
        (local.set $p01 (i32.add (local.get $p00) (local.get $rowC)))
        (local.set $p10 (i32.add (local.get $p00) (i32.mul (local.get $W) (local.get $rowC))))
        (local.set $p11 (i32.add (local.get $p10) (local.get $rowC)))
        (local.set $c (i32.const 0))
        (block $vd
          (loop $vl
            (br_if $vd (i32.ge_u (local.get $c) (local.get $vecEnd)))
            (v128.store (i32.add (local.get $y) (local.get $c))
              (f32x4.max
                (f32x4.max (v128.load (i32.add (local.get $p00) (local.get $c))) (v128.load (i32.add (local.get $p01) (local.get $c))))
                (f32x4.max (v128.load (i32.add (local.get $p10) (local.get $c))) (v128.load (i32.add (local.get $p11) (local.get $c))))))
            (local.set $c (i32.add (local.get $c) (i32.const 16)))
            (br $vl)))
        (block $sd
          (loop $sl
            (br_if $sd (i32.ge_u (local.get $c) (local.get $rowC)))
            (f32.store (i32.add (local.get $y) (local.get $c))
              (f32.max
                (f32.max (f32.load (i32.add (local.get $p00) (local.get $c))) (f32.load (i32.add (local.get $p01) (local.get $c))))
                (f32.max (f32.load (i32.add (local.get $p10) (local.get $c))) (f32.load (i32.add (local.get $p11) (local.get $c))))))
            (local.set $c (i32.add (local.get $c) (i32.const 4)))
            (br $sl)))
        (local.set $y (i32.add (local.get $y) (local.get $rowC)))
        (local.set $ox (i32.add (local.get $ox) (i32.const 1)))
        (br_if $xl (i32.lt_u (i32.shl (local.get $ox) (i32.const 1)) (local.get $W))))
      (local.set $oy (i32.add (local.get $oy) (i32.const 1)))
      (br_if $yl (i32.lt_u (i32.shl (local.get $oy) (i32.const 1)) (local.get $H)))))

  ;; Appends zero channels: each of P pixels goes from C to OC channels.
  (func (export "padChannels") (param $x i32) (param $P i32) (param $C i32) (param $OC i32) (param $y i32)
    (local $p i32) (local $in i32) (local $out i32)
    (local.set $in (i32.shl (local.get $C) (i32.const 2)))
    (local.set $out (i32.shl (local.get $OC) (i32.const 2)))
    (memory.fill (local.get $y) (i32.const 0) (i32.mul (local.get $P) (local.get $out)))
    (block $d
      (loop $l
        (br_if $d (i32.ge_u (local.get $p) (local.get $P)))
        (memory.copy
          (i32.add (local.get $y) (i32.mul (local.get $p) (local.get $out)))
          (i32.add (local.get $x) (i32.mul (local.get $p) (local.get $in)))
          (local.get $in))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l))))

  ;; "im2col" for a K x K convolution: each output pixel's patch becomes one
  ;; row of K*K*C floats. Each patch row is a contiguous run of the input
  ;; (NHWC), so it's copied whole, with zeros where it hangs over an edge.
  (func (export "unfold")
    (param $x i32) (param $H i32) (param $W i32) (param $C i32) (param $K i32) (param $s i32)
    (param $pt i32) (param $pl i32) (param $y i32) (param $OH i32) (param $OW i32)
    (local $oy i32) (local $ox i32) (local $ky i32) (local $iy i32) (local $ix0 i32)
    (local $lo i32) (local $hi i32) (local $px i32) (local $run i32)
    (local.set $px (i32.shl (local.get $C) (i32.const 2)))
    (local.set $run (i32.mul (local.get $K) (local.get $px)))
    (loop $yl
      (local.set $ox (i32.const 0))
      (loop $xl
        (local.set $ix0 (i32.sub (i32.mul (local.get $ox) (local.get $s)) (local.get $pl)))
        ;; columns [lo, hi) of this patch row lie inside the image
        (local.set $lo (select (i32.sub (i32.const 0) (local.get $ix0)) (i32.const 0) (i32.lt_s (local.get $ix0) (i32.const 0))))
        (local.set $hi (i32.sub (local.get $W) (local.get $ix0)))
        (if (i32.gt_s (local.get $hi) (local.get $K)) (then (local.set $hi (local.get $K))))
        (local.set $ky (i32.const 0))
        (loop $kl
          (local.set $iy (i32.add (i32.sub (i32.mul (local.get $oy) (local.get $s)) (local.get $pt)) (local.get $ky)))
          (if (i32.and (i32.ge_s (local.get $iy) (i32.const 0)) (i32.lt_s (local.get $iy) (local.get $H)))
            (then
              (memory.fill (local.get $y) (i32.const 0) (local.get $run))
              (memory.copy
                (i32.add (local.get $y) (i32.mul (local.get $lo) (local.get $px)))
                (i32.add (local.get $x)
                  (i32.mul (i32.add (i32.mul (local.get $iy) (local.get $W)) (i32.add (local.get $ix0) (local.get $lo))) (local.get $px)))
                (i32.mul (i32.sub (local.get $hi) (local.get $lo)) (local.get $px))))
            (else (memory.fill (local.get $y) (i32.const 0) (local.get $run))))
          (local.set $y (i32.add (local.get $y) (local.get $run)))
          (local.set $ky (i32.add (local.get $ky) (i32.const 1)))
          (br_if $kl (i32.lt_u (local.get $ky) (local.get $K))))
        (local.set $ox (i32.add (local.get $ox) (i32.const 1)))
        (br_if $xl (i32.lt_u (local.get $ox) (local.get $OW))))
      (local.set $oy (i32.add (local.get $oy) (i32.const 1)))
      (br_if $yl (i32.lt_u (local.get $oy) (local.get $OH)))))

  ;; y = x + z (optionally ReLU'd), n floats, n % 4 == 0.
  (func (export "add") (param $x i32) (param $z i32) (param $y i32) (param $n i32) (param $relu i32)
    (local $i i32) (local $end i32) (local $v v128)
    (local.set $end (i32.shl (local.get $n) (i32.const 2)))
    (block $d
      (loop $l
        (br_if $d (i32.ge_u (local.get $i) (local.get $end)))
        (local.set $v (f32x4.add (v128.load (i32.add (local.get $x) (local.get $i))) (v128.load (i32.add (local.get $z) (local.get $i)))))
        (if (local.get $relu) (then (local.set $v (f32x4.max (local.get $v) (v128.const f32x4 0 0 0 0)))))
        (v128.store (i32.add (local.get $y) (local.get $i)) (local.get $v))
        (local.set $i (i32.add (local.get $i) (i32.const 16)))
        (br $l))))
)
