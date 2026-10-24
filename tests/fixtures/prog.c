#include <stdio.h>
#define N 7

/* compute the sum of an array */
int sum(int a[], int n) {
    int s = 0, i;
    for (i = 0; i < n; i++) {
        s += a[i];
    }
    return s;
}

int maxOf(int a[], int n) {
    int best = a[0];
    int i = 1;
    while (i < n) {
        if (a[i] > best) best = a[i];
        i++;
    }
    return best;
}

int main() {
    int marks[N] = {78, 92, 45, 66, 88, 39, 95};
    int total = sum(marks, N);
    int failed = 0;
    float avg = total / (float)N;
    for (int k = 0; k < N; k++) {
        if (marks[k] < 40) {
            failed = failed + 1;
        } else {
            printf("pass %d\n", marks[k]);
        }
    }
    printf("total=%d max=%d avg=%.2f failed=%d\n", total, maxOf(marks, N), avg, failed);
    return 0;
}
