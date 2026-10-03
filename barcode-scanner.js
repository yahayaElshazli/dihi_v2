(() => {
  const openButton = document.getElementById('scanBarcodeBtn');
  const sheet = document.getElementById('barcodeScanSheet');
  const cancelButton = document.getElementById('barcodeScanCancel');
  const barcodeInput = document.getElementById('addBarcode');
  const message = document.getElementById('barcodeScanMsg');
  const readerId = 'barcodeScannerView';
  let scanner = null;
  let starting = false;
  let stopping = false;
  let scanHandled = false;
  let closeRequested = false;

  if (!openButton || !sheet || !barcodeInput || !message) return;

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? 'var(--rust)' : 'var(--ink-dim)';
  }

  async function stopScanner() {
    if (!scanner || stopping) return;
    stopping = true;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch (_) {
      // The camera may already have stopped after a successful scan or browser dismissal.
    }
    try { scanner.clear(); } catch (_) {}
    scanner = null;
    stopping = false;
  }

  async function startScanner() {
    if (starting) return;
    starting = true;
    scanHandled = false;
    closeRequested = false;
    setMessage('Starting camera…');
    if (!window.Html5Qrcode || !window.Html5QrcodeSupportedFormats) {
      setMessage('The scanner could not load. Enter the barcode manually instead.', true);
      starting = false;
      return;
    }

    const formats = window.Html5QrcodeSupportedFormats;
    scanner = new window.Html5Qrcode(readerId, {
      formatsToSupport: [formats.UPC_A, formats.UPC_E, formats.EAN_13, formats.EAN_8],
      verbose: false
    });
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (width, height) => ({ width: Math.min(width - 24, 340), height: Math.min(height - 24, 150) }) },
        async decodedText => {
          if (scanHandled) return;
          scanHandled = true;
          const code = String(decodedText).trim();
          if (!/^\d{8,14}$/.test(code)) {
            scanHandled = false;
            setMessage('That code did not look like a UPC/EAN barcode. Try again.');
            return;
          }
          barcodeInput.value = code;
          barcodeInput.dispatchEvent(new Event('input', { bubbles: true }));
          barcodeInput.dispatchEvent(new CustomEvent('barcode:scanned', { bubbles: true, detail: { barcode: code } }));
          setMessage('Barcode scanned.');
          await stopScanner();
          if (sheet.open) sheet.close();
          barcodeInput.focus();
        },
        () => {}
      );
      if (closeRequested || !sheet.open) {
        await stopScanner();
        return;
      }
      setMessage('Hold the barcode inside the frame.');
    } catch (error) {
      await stopScanner();
      const text = String(error && (error.message || error) || '').toLowerCase();
      if (text.includes('permission') || text.includes('notallowed')) {
        setMessage('Camera access was blocked. Allow camera access in your browser, or enter the barcode manually.', true);
      } else if (!window.isSecureContext) {
        setMessage('Camera scanning needs a secure (HTTPS) connection. Enter the barcode manually.', true);
      } else {
        setMessage('Could not start the camera. Check browser permission and try again, or enter the barcode manually.', true);
      }
    } finally {
      starting = false;
    }
  }

  openButton.addEventListener('click', () => {
    if (!sheet.open) sheet.showModal();
    startScanner();
  });
  cancelButton.addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    closeRequested = true;
    if (!starting) stopScanner();
  });
  sheet.addEventListener('click', event => {
    if (event.target === sheet) sheet.close();
  });
})();
