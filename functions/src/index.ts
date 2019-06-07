const functions = require('firebase-functions');
const admin = require('firebase-admin');
const FieldValue = admin.firestore.FieldValue;
admin.initializeApp();
const db = admin.firestore(functions.config().firebase);

// USER

exports.removeUser = functions.auth.user().onDelete(user => {
  const userId = user.uid;

  return db
    .collection('project_user')
    .where(`users.${userId}`, '==', true)
    .get()
    .then(snapshot => {
      const batch = db.batch();

      for (const projectUserSnapshot of snapshot.docs) {
        batch.set(
          projectUserSnapshot.ref,
          { users: { [userId]: FieldValue.delete() } },
          { merge: true }
        );
      }

      const userProjectRef = db.doc(`user_project/${userId}`);
      batch.delete(userProjectRef);

      return batch.commit();
    });
});

// PROJECT

exports.getProjects = functions.https.onCall((_, context) => {
  const userId = context.auth.uid;

  return db
    .doc(`user_project/${userId}`)
    .get()
    .then(userProjectSnapshot => {
      if (userProjectSnapshot.exists) {
        const promises = Object.keys(userProjectSnapshot.get('projects')).map(
          projectId => db.doc(`projects/${projectId}`).get()
        );

        return Promise.all(promises).then(projectsSnapshot =>
          projectsSnapshot
            .map(projectSnapshot => projectSnapshot.data())
            .map(project => {
              // Remove password field from the response
              return {
                id: project.id,
                name: project.name
              };
            })
        );
      } else {
        return [];
      }
    });
});

exports.getProjectsWithDailyState = functions.https.onCall((_, context) => {
  const userId = context.auth.uid;

  return db
    .doc(`user_project/${userId}`)
    .get()
    .then(userProjectSnapshot => {
      if (userProjectSnapshot.exists) {
        const promises = Object.keys(userProjectSnapshot.get('projects')).map(
          projectId => {
            const projectPromise = db.doc(`projects/${projectId}`).get();
            const dailyPromise = db.doc(`dailies/${projectId}`).get();
            const projectUserPromise = db
              .doc(`project_user/${projectId}`)
              .get();

            return Promise.all([
              projectPromise,
              dailyPromise,
              projectUserPromise
            ]).then(result => {
              const project = result[0].data();
              const daily = result[1].data();
              const projectUser = result[2].data();

              const membersCount = Object.keys(projectUser.users).length;

              return {
                project: {
                  id: project.id,
                  name: project.name
                },
                membersCount: membersCount,
                daily: daily
              };
            });
          }
        );

        return Promise.all(promises);
      } else {
        return [];
      }
    });
});

exports.getProject = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .collection('projects')
    .where('id', '==', projectId)
    .get()
    .then(snapshot => {
      if (snapshot.size <= 0) {
        throw new functions.https.HttpsError('not-found', 'project not found');
      } else if (snapshot.size > 1) {
        throw new functions.https.HttpsError(
          'unknown',
          'mutliple projects found with specified id'
        );
      } else {
        return getUsers(projectId).then(users => {
          const project = snapshot.docs[0].data();
          return {
            id: project.id,
            name: project.name,
            users: users,
            password: project.password
          };
        });
      }
    });
});

exports.newProject = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectName and password should be provided!'
    );
  }

  const userId = context.auth.uid;
  const projectName = data.projectName;
  const password = data.password;

  if (projectName === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectName should be provided!'
    );
  }
  if (password === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'password should be provided!'
    );
  }

  return db
    .collection('projects')
    .where('name', '==', projectName)
    .get()
    .then(snapshot => {
      if (snapshot.size > 0) {
        throw new functions.https.HttpsError(
          'already-exists',
          `project with name ${projectName} exists`
        );
      } else {
        const batch = db.batch();

        const newProjectRef = db.collection('projects').doc();
        batch.set(newProjectRef, {
          name: projectName,
          id: newProjectRef.id,
          password: password
        });

        const userProjectRef = db.doc(`user_project/${userId}`);
        batch.set(
          userProjectRef,
          { projects: { [newProjectRef.id]: true } },
          { merge: true }
        );

        const projectUserRef = db.doc(`project_user/${newProjectRef.id}`);
        batch.set(
          projectUserRef,
          { users: { [userId]: true } },
          { merge: true }
        );

        return batch.commit().then(_ => {
          return {
            projectId: newProjectRef.id
          };
        });
      }
    });
});

exports.joinProject = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectName and password should be provided!'
    );
  }

  const userId = context.auth.uid;
  const projectName = data.projectName;
  const userPassword = data.password;

  if (projectName === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectName should be provided!'
    );
  }
  if (userPassword === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'password should be provided!'
    );
  }

  return db
    .collection('projects')
    .where('name', '==', projectName)
    .get()
    .then(snapshot => {
      if (snapshot.size <= 0) {
        throw new functions.https.HttpsError('not-found', 'project not found');
      } else if (snapshot.size > 1) {
        throw new functions.https.HttpsError(
          'unknown',
          'mutliple projects found with specified name'
        );
      } else {
        const projectRef = snapshot.docs[0];
        const projectPassword = projectRef.data().password;
        if (projectPassword === userPassword) {
          const batch = db.batch();

          const userProjectRef = db.doc(`user_project/${userId}`);
          batch.set(
            userProjectRef,
            { projects: { [projectRef.id]: true } },
            { merge: true }
          );

          const projectUserRef = db.doc(`project_user/${projectRef.id}`);
          batch.set(
            projectUserRef,
            { users: { [userId]: true } },
            { merge: true }
          );

          return batch.commit().then(_ => {
            return {
              projectId: projectRef.id
            };
          });
        } else {
          throw new functions.https.HttpsError(
            'invalid-argument',
            'invalid password'
          );
        }
      }
    });
});

exports.deleteProject = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .doc(`project_user/${projectId}`)
    .get()
    .then(snapshot => {
      const batch = db.batch();

      const userIds = Object.keys(snapshot.get('users'));
      userIds.forEach(id => {
        const userProjectRef = db.doc(`user_project/${id}`);
        batch.update(userProjectRef, {
          [`projects.${projectId}`]: FieldValue.delete()
        });
      });
      batch.delete(snapshot.ref);

      const projectRef = db.doc(`projects/${projectId}`);
      batch.delete(projectRef);

      return batch.commit();
    });
});

exports.leaveProject = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const userId = context.auth.uid;
  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const batch = db.batch();

  const projectUserRef = db.doc(`project_user/${projectId}`);
  batch.update(projectUserRef, { [`users.${userId}`]: FieldValue.delete() });

  const userProjectRef = db.doc(`user_project/${userId}`);
  batch.update(userProjectRef, {
    [`projects.${projectId}`]: FieldValue.delete()
  });

  return batch.commit();
});

exports.changeProjectPassword = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;
  const newPassword = data.newPassword;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }
  if (newPassword === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'newPassword should be provided!'
    );
  }

  return db.doc(`projects/${projectId}`).update({ password: newPassword });
});

// DAILY

exports.joinDaily = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const userId = context.auth.uid;
  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .doc(`dailies/${projectId}`)
    .get()
    .then(dailySnapshot => {
      if (dailySnapshot.exists) {
        return joinDaily(userId, dailySnapshot);
      } else {
        return createDaily(projectId, userId, dailySnapshot);
      }
    });
});

exports.leaveDaily = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const userId = context.auth.uid;
  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .doc(`dailies/${projectId}`)
    .get()
    .then(dailySnapshot => {
      const batch = db.batch();
      const daily = dailySnapshot.data();

      if (daily.queue) {
        const index = daily.queue.indexOf(userId);
        if (index >= 0) {
          daily.queue.splice(index, 1);
        }

        if (daily.queue.length === 0) {
          //End daily
          return dailySnapshot.ref.delete();
        }

        batch.set(dailySnapshot.ref, { queue: daily.queue }, { merge: true });
      } else {
        const activeUsersCount = [...Object.keys(daily.users)].filter(
          userKey => daily.users[userKey].active === true
        ).length;
        if (activeUsersCount <= 1) {
          //End daily
          return dailySnapshot.ref.delete();
        }
      }

      batch.set(
        dailySnapshot.ref,
        { users: { [userId]: { active: false } } },
        { merge: true }
      );

      return batch.commit();
    });
});

exports.finishDaily = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db.doc(`dailies/${projectId}`).delete();
});

exports.startDaily = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .doc(`dailies/${projectId}`)
    .get()
    .then(dailySnapshot => {
      const daily = dailySnapshot.data();
      if (daily.state === 'in-progress') {
        return;
      }

      const activeUserIds = Object.keys(daily.users).filter(
        userId => daily.users[userId].active
      );

      shuffleArray(activeUserIds);

      const startTime = Date.now();
      return dailySnapshot.ref.set(
        {
          queue: activeUserIds,
          state: 'in-progress',
          startTime: startTime
        },
        { merge: true }
      );
    });
});

exports.nextDailyUser = functions.https.onCall((data, context) => {
  if (data === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  const projectId = data.projectId;

  if (projectId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'projectId should be provided!'
    );
  }

  return db
    .doc(`dailies/${projectId}`)
    .get()
    .then(dailySnapshot => {
      const daily = dailySnapshot.data();

      if (daily.state !== 'in-progress') {
        return;
      }

      if (daily.queue) {
        daily.queue.splice(0, 1);

        if (daily.queue.length <= 0) {
          //End daily
          return dailySnapshot.ref.delete();
        } else {
          return dailySnapshot.ref.set({ queue: daily.queue }, { merge: true });
        }
      } else {
        return;
      }
    });
});

// PRIVATE METHODS

function getUsers(projectId) {
  return db
    .doc(`project_user/${projectId}`)
    .get()
    .then(projectUserSnapshot => {
      const userIds = Object.keys(projectUserSnapshot.get('users'));
      const userPromises = userIds.map(userId =>
        admin
          .auth()
          .getUser(userId)
          .then(userRecord => {
            return {
              uid: userRecord.uid,
              email: userRecord.email,
              displayName: userRecord.displayName
            };
          })
      );
      return Promise.all(userPromises);
    });
}

function createDaily(projectId, userId, dailySnapshot) {
  const projectPromise = db
    .doc(`projects/${projectId}`)
    .get()
    .then(snapshot => snapshot.data());
  const usersPromise = getUsers(projectId).then(users => {
    const updatedUsers = users.map(user => {
      user.active = user.uid === userId;
      return user;
    });

    const map = {};
    updatedUsers.forEach(user => {
      map[user.uid] = user;
    });
    return map;
  });

  return Promise.all([projectPromise, usersPromise]).then(result => {
    const [project, users] = result;
    return dailySnapshot.ref.set({
      project: {
        id: project.id,
        name: project.name
      },
      users: users,
      state: 'idle'
    });
  });
}

function joinDaily(userId, dailySnapshot) {
  return admin
    .auth()
    .getUser(userId)
    .then(userRecord => {
      const batch = db.batch();
      const user = {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        active: true
      };

      batch.set(
        dailySnapshot.ref,
        { users: { [userId]: user } },
        { merge: true }
      );

      if (dailySnapshot.get('state') === 'in-progress') {
        const queue = dailySnapshot.get('queue');
        queue.push(userId);

        batch.set(dailySnapshot.ref, { queue: queue }, { merge: true });
      }

      return batch.commit();
    });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

exports.noti = functions.firestore
.document('dailies/{dailyId}')
.onCreate((snap, context) => {
  // Get an object representing the document
  // e.g. {'name': 'Marie', 'age': 66}
  const newValue = snap.data();
  console.log(newValue);
  // access a particular field as you would any JS property
  const name = newValue.name;

  // perform desired operations ...
});


exports.createNotifications = functions.firestore
  .document('dailies/{dailyId}')
  .onCreate((snapshot, context) => {
    const text = snapshot.data().project.name;
    console.log("create notification: " + text)
    const payload = {
      notification: {
        title: text,
        body_loc_key: 'DailyStartedNotificationBody',
        icon: 'ic_daily_24dp_white',
        sound: 'default'
      }
    };
    const options = {
      priority: 'high'
    };
    const users = snapshot.data().users;
    const usersArray = Object.keys(users);
    const promises = usersArray.map(userId => fetchTokenForUser(userId));
    return Promise.all(promises)
      .then(list => {
        return admin
          .messaging()
          .sendToDevice(list.filter(item => item), payload, options);
      })
      .catch(() => console.log('something went wrong'));
  });

function fetchTokenForUser(userid) {
  return db
    .doc(`fcm_tokens/${userid}`)
    .get()
    .then(doc => {
      if (doc.exists) return doc.data().token;
    });
}
