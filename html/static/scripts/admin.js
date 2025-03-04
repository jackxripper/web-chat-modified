document.addEventListener('DOMContentLoaded', (event) => {
    // Check for authentication token
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
        // Redirect to login page if not authenticated
        window.location.href = 'login.html';
        return;
    }

    const userTableBody = document.querySelector('#user-table tbody');
    const banButton = document.getElementById('ban-button');
    const banUserInput = document.getElementById('ban-user');

    // Fetch usernames from the server
    fetch('/api/admin/users', {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
    .then(response => response.json())
    .then(data => {
        data.forEach(addRow);
    });

    // Function to add a row to the table
    function addRow({ username, ip }) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${username}</td><td>${ip}</td>`;
        userTableBody.appendChild(row);
    }

    // Function to handle banning user
    banButton.addEventListener('click', () => {
        const userToBan = banUserInput.value;
        if (userToBan) {
            fetch('/api/admin/ban', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ username: userToBan })
            }).then(response => {
                if (response.ok) {
                    console.log(`User ${userToBan} banned`);
                    banUserInput.value = '';
                } else {
                    alert('Failed to ban user');
                }
            });
        } else {
            alert('Please enter a username to ban');
        }
    });
});
