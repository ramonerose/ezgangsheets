import fs from 'fs';
import path from 'path';

// File to store user data
const USERS_FILE = 'users.json';

// Load users from file
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return new Map(JSON.parse(data));
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
    return new Map();
}

// Save users to file
function saveUsers(users) {
    try {
        const data = JSON.stringify(Array.from(users.entries()));
        fs.writeFileSync(USERS_FILE, data, 'utf8');
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

// Add a new user
function addUser(email, userData) {
    const users = loadUsers();
    users.set(email, userData);
    saveUsers(users);
    return userData;
}

// Get user by email
function getUser(email) {
    const users = loadUsers();
    return users.get(email);
}

// Get all users (for admin)
function getAllUsers() {
    const users = loadUsers();
    return Array.from(users.entries()).map(([email, user]) => ({
        email,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
        plan: user.plan,
        createdAt: user.createdAt || new Date().toISOString()
    }));
}

// Update user
function updateUser(email, updates) {
    const users = loadUsers();
    const user = users.get(email);
    if (user) {
        const updatedUser = { ...user, ...updates };
        users.set(email, updatedUser);
        saveUsers(users);
        return updatedUser;
    }
    return null;
}

// Delete user
function deleteUser(email) {
    const users = loadUsers();
    const deleted = users.delete(email);
    if (deleted) {
        saveUsers(users);
    }
    return deleted;
}

export {
    loadUsers,
    saveUsers,
    addUser,
    getUser,
    getAllUsers,
    updateUser,
    deleteUser
};
