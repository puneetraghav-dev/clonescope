#include <stdio.h>

int rsum(int v[], int n) {
    if (n == 0) return 0;
    return v[n - 1] + rsum(v, n - 1);
}

int rmax(int v[], int n) {
    if (n == 1) return v[0];
    int m = rmax(v, n - 1);
    return v[n - 1] > m ? v[n - 1] : m;
}

int rmin(int v[], int n) {
    if (n == 1) return v[0];
    int m = rmin(v, n - 1);
    return v[n - 1] < m ? v[n - 1] : m;
}

int countEven(int v[], int n) {
    if (n == 0) return 0;
    return (v[n - 1] % 2 == 0) + countEven(v, n - 1);
}

void printReverse(int v[], int n) {
    if (n == 0) return;
    printf(" %d", v[n - 1]);
    printReverse(v, n - 1);
}

int pal(int v[], int lo, int hi) {
    if (lo >= hi) return 1;
    if (v[lo] != v[hi]) return 0;
    return pal(v, lo + 1, hi - 1);
}

int main() {
    int n, v[100];
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &v[i]);
    int total = rsum(v, n), hi = rmax(v, n);
    printf("Sum: %d\nAverage: %.2f\n", total, (double)total / n);
    printf("Max: %d\nMin: %d\n", hi, rmin(v, n));
    int best = -1, have = 0;
    for (int i = 0; i < n; i++)
        if (v[i] < hi && (!have || v[i] > best)) { best = v[i]; have = 1; }
    if (have) printf("Second largest: %d\n", best);
    else printf("Second largest: none\n");
    int ev = countEven(v, n);
    printf("Even: %d Odd: %d\n", ev, n - ev);
    printf("Reversed:");
    printReverse(v, n);
    printf("\nPalindrome: %s\n", pal(v, 0, n - 1) ? "Yes" : "No");
    return 0;
}
