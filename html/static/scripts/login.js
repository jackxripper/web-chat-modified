document.getElementById('login-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const password = document.getElementById('admin-password').value;
    // Send password to the server for validation
    fetch('/api/admin/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: password })
    }).then(response => response.json())
      .then(data => {
          if (data.success) {
              // Store authentication token in local storage
              localStorage.setItem('authToken', data.token);
              // Redirect to the admin control panel if password is valid
              window.location.href = 'admin.html';
          } else {
              // Show error message if password is invalid
              document.getElementById('error-message').style.display = 'block';
          }
      });
});
